// Browser stand-in for node:http, used only by pi-ai's OAuth flows. The "server" pretends to listen on the
// requested port. The browser's redirect to it cannot arrive, so the page lets the user paste the redirect URL and
// delivers it to the server's handler with `deliverCallback`, as if the browser had loaded it.
type Listener = (...args: unknown[]) => void;
type Handler = (request: FakeRequest, response: FakeResponse) => void;
type FakeRequest = { method: string; url: string; headers: Record<string, string> };

const listening = new Set<FakeServer>();

class FakeResponse {
	status = 200;
	#done: (result: { status: number; body: string }) => void;
	constructor(done: (result: { status: number; body: string }) => void) {
		this.#done = done;
	}
	writeHead(status: number): this {
		this.status = status;
		return this;
	}
	setHeader(): this {
		return this;
	}
	end(body?: string): void {
		this.#done({ status: this.status, body: body ?? "" });
	}
}

/** Whether a flow is waiting for a callback, so the page should offer a paste field. */
export function hasListeningServer(): boolean {
	return listening.size > 0;
}

/** Delivers a pasted redirect URL (http://localhost:PORT/path?code=...) to the waiting flow's handler. */
export function deliverCallback(raw: string): Promise<{ status: number; body: string }> {
	const url = new URL(raw.trim());
	const servers = [...listening];
	const server = servers.find((s) => s.port === Number(url.port)) ?? (servers.length === 1 ? servers[0] : undefined);
	if (!server?.handler) return Promise.reject(new Error("No sign-in is waiting for this address."));
	const handler = server.handler;
	return new Promise((resolve) => {
		handler({ method: "GET", url: url.pathname + url.search, headers: { host: url.host } }, new FakeResponse(resolve));
	});
}

class FakeServer {
	readonly handler: Handler | undefined;
	port = 0;
	constructor(handler: Handler | undefined) {
		this.handler = handler;
	}
	#listeners = new Map<string, Set<Listener>>();
	listen(port: number, ...rest: unknown[]): this {
		this.port = port || 1455;
		listening.add(this);
		const callback = rest.find((r) => typeof r === "function") as (() => void) | undefined;
		queueMicrotask(() => {
			callback?.();
			this.emit("listening");
		});
		return this;
	}
	address(): { port: number; address: string; family: string } {
		return { port: this.port, address: "127.0.0.1", family: "IPv4" };
	}
	on(event: string, listener: Listener): this {
		if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
		this.#listeners.get(event)?.add(listener);
		return this;
	}
	addListener(event: string, listener: Listener): this {
		return this.on(event, listener);
	}
	once(event: string, listener: Listener): this {
		const wrapped: Listener = (...args) => {
			this.off(event, wrapped);
			listener(...args);
		};
		return this.on(event, wrapped);
	}
	off(event: string, listener: Listener): this {
		this.#listeners.get(event)?.delete(listener);
		return this;
	}
	removeListener(event: string, listener: Listener): this {
		return this.off(event, listener);
	}
	removeAllListeners(event?: string): this {
		if (event) this.#listeners.delete(event);
		else this.#listeners.clear();
		return this;
	}
	emit(event: string, ...args: unknown[]): boolean {
		const set = this.#listeners.get(event);
		for (const listener of set ?? []) listener(...args);
		return Boolean(set?.size);
	}
	close(callback?: () => void): this {
		listening.delete(this);
		queueMicrotask(() => callback?.());
		return this;
	}
	closeAllConnections(): void {}
	closeIdleConnections(): void {}
	unref(): this {
		return this;
	}
	ref(): this {
		return this;
	}
}

export function createServer(...args: unknown[]): FakeServer {
	return new FakeServer(args.find((a) => typeof a === "function") as Handler | undefined);
}
export type ServerResponse = never;
export type Server = FakeServer;
export default { createServer };
