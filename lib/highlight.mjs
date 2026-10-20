// TypeScript/JavaScript-like token highlighter. Input is plain source text; output is escaped HTML with <span class="tk-*">.
const KEYWORDS = new Set(
	(
		"as async await break case catch class const continue debugger default delete do else enum export extends " +
		"false finally for from function if implements import in instanceof interface let new null of private " +
		"protected public readonly return satisfies static super switch this throw true try type typeof undefined " +
		"var void while with yield keyof infer never unknown any declare abstract"
	).split(" "),
);

const TOKEN =
	/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g;

export const decode = (s) =>
	s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
export const encode = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const span = (cls, text) => `<span class="tk-${cls}">${encode(text)}</span>`;

export function highlight(source) {
	let out = "";
	let last = 0;
	for (const m of source.matchAll(TOKEN)) {
		out += encode(source.slice(last, m.index));
		last = m.index + m[0].length;
		const [text, comment, string, number, ident] = m;
		if (comment) out += span("c", text);
		else if (string) out += span("s", text);
		else if (number) out += span("n", text);
		else if (ident && KEYWORDS.has(ident)) out += span("k", text);
		else if (ident && /^[A-Z][a-z0-9]/.test(ident)) out += span("t", text);
		else if (ident && /^\s*(?:<[^>\n]*>)?\s*\(/.test(source.slice(last, last + 60))) out += span("f", text);
		else out += encode(text);
	}
	return out + encode(source.slice(last));
}

