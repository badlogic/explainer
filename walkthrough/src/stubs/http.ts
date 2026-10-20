// Browser stand-in for node:http, used only by pi-ai's OAuth flows. The "server" pretends to listen on the
// requested port and never receives a request, so every flow waits for the pasted redirect URL instead.
type Listener = (...args: unknown[]) => void;

class FakeServer {
	#port = 0;
	listen(port: number, _host: string, callback?: () => void): this {
		this.#port = port || 1455;
		queueMicrotask(() => callback?.());
		return this;
	}
	address(): { port: number; address: string; family: string } {
		return { port: this.#port, address: "127.0.0.1", family: "IPv4" };
	}
	on(_event: string, _listener: Listener): this {
		return this;
	}
	once(_event: string, _listener: Listener): this {
		return this;
	}
	off(_event: string, _listener: Listener): this {
		return this;
	}
	close(callback?: () => void): this {
		queueMicrotask(() => callback?.());
		return this;
	}
	closeAllConnections(): void {}
}

export function createServer(_handler?: Listener): FakeServer {
	return new FakeServer();
}
export type ServerResponse = never;
export type Server = FakeServer;
export default { createServer };
