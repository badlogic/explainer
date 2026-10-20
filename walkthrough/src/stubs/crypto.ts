// Browser stand-in for node:crypto: only randomBytes, as pi-ai's OAuth flows use it.
const encode = (bytes: Uint8Array, encoding?: string): string => {
	if (encoding === "hex") return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
	const base64 = btoa(String.fromCharCode(...bytes));
	if (encoding === "base64url") return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	return base64;
};

export function randomBytes(size: number): { toString(encoding?: string): string } {
	const bytes = crypto.getRandomValues(new Uint8Array(size));
	return { toString: (encoding) => encode(bytes, encoding) };
}
export function randomUUID(): string {
	return crypto.randomUUID();
}
export default { randomBytes, randomUUID };
