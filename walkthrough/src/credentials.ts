// A pi-ai CredentialStore over IndexedDB: credentials survive reloads and stay in this browser profile.
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";

const STORE = "credentials";

function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export class IndexedDbCredentialStore implements CredentialStore {
	readonly #db: IDBDatabase;
	readonly #chains = new Map<string, Promise<unknown>>();

	private constructor(db: IDBDatabase) {
		this.#db = db;
	}

	static async open(name: string): Promise<IndexedDbCredentialStore> {
		const req = indexedDB.open(name, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		return new IndexedDbCredentialStore(await request(req));
	}

	#store(mode: IDBTransactionMode): IDBObjectStore {
		return this.#db.transaction(STORE, mode).objectStore(STORE);
	}

	async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
		options?.signal?.throwIfAborted();
		return (await request(this.#store("readonly").get(providerId))) as Credential | undefined;
	}

	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		options?.signal?.throwIfAborted();
		const store = this.#store("readonly");
		const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
		return keys.map((key, i) => ({ providerId: String(key), type: (values[i] as Credential).type }));
	}

	/** Serialized per provider: `fn` always sees the value the previous write left. */
	modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		const previous = this.#chains.get(providerId) ?? Promise.resolve();
		const next = previous
			.catch(() => undefined)
			.then(async () => {
				options?.signal?.throwIfAborted();
				const updated = await fn(await this.read(providerId));
				const store = this.#store("readwrite");
				if (updated === undefined) await request(store.delete(providerId));
				else await request(store.put(updated, providerId));
				return updated;
			});
		this.#chains.set(providerId, next);
		return next;
	}

	async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
		await this.modify(providerId, async () => undefined, options);
	}
}
