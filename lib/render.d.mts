export function activate(root: ParentNode): void;
export function encode(text: string): string;
export function md(markdown: string): string;
export function mdInline(markdown: string | undefined): string;
export class Book {
	constructor(options?: { prefix?: string; start?: number });
	figures: number;
	usesRuntime: boolean;
	blocks(markdown: string): string;
}
