// Browser stand-in for node:http, used only by pi-ai's OAuth flows. The "server" pretends to listen on the
// requested port and never receives a request, so every flow waits for the pasted redirect URL instead.
type Listener = (...args: unknown[]) => void;

class FakeServer {
	#port = 0;
	#listeners = new Map<string, Set<Listener>>();
	listen(port: number, ...rest: unknown[]): this {
		this.#port = port || 1455;
		const callback = rest.find((r) => typeof r === "function") as (() => void) | undefined;
		queueMicrotask(() => {
			callback?.();
			this.emit("listening");
		});
		return this;
	}
	address(): { port: number; address: string; family: string } {
		return { port: this.#port, address: "127.0.0.1", family: "IPv4" };
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

export function createServer(..._args: unknown[]): FakeServer {
	return new FakeServer();
}
export type ServerResponse = never;
export type Server = FakeServer;
export default { createServer };
