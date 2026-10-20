// Browser-safe renderer shared by build.mjs (books) and the walkthrough runtime (cards).
import { Marked } from "marked";
import { flow, sequence } from "./diagrams.mjs";
import { encode, highlight } from "./highlight.mjs";

export { encode };

export const CODE_LANGS = new Set(["ts", "typescript", "js", "javascript", "tsx", "jsx", "json", "jsonc", "sh", "bash"]);
export const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII", "XXIII", "XXIV", "XXV"];

/** Starts animations and steppers inside `root` (a document or an element). Idempotent per element. */
export function activate(root) {
	const replay = (f) => {
		f.classList.remove("play");
		void f.getBoundingClientRect();
		f.classList.add("play");
	};
	const io = new IntersectionObserver(
		(es) => {
			for (const e of es)
				if (e.isIntersecting) {
					e.target.classList.add("play");
					io.unobserve(e.target);
				}
		},
		{ threshold: 0.3 },
	);
	root.querySelectorAll(".anim:not(.armed)").forEach((f) => {
		f.classList.add("armed");
		io.observe(f);
		const b = f.querySelector(".replay");
		if (b) b.onclick = () => replay(f);
	});
	root.querySelectorAll(".steps:not(.js)").forEach((s) => {
		s.classList.add("js");
		const ps = [...s.querySelectorAll(":scope>.step-panel")];
		let i = 0;
		const c = s.querySelector(".count"),
			p = s.querySelector(".prev"),
			n = s.querySelector(".next");
		const show = () => {
			ps.forEach((x, j) => x.classList.toggle("on", j === i));
			c.textContent = `${i + 1} / ${ps.length}`;
			p.disabled = i === 0;
			n.disabled = i === ps.length - 1;
			ps[i].querySelectorAll(".anim").forEach(replay);
		};
		p.onclick = () => {
			i--;
			show();
		};
		n.onclick = () => {
			i++;
			show();
		};
		show();
	});
}


export const slug = (s) =>
	s
		.toLowerCase()
		.replace(/<[^>]+>/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

/* ------------------------------------------------------------ front matter */

export function frontMatter(text) {
	const meta = {};
	if (!text.startsWith("---\n")) return { meta, body: text };
	const end = text.indexOf("\n---\n", 4);
	if (end < 0) throw new Error("front matter: missing closing ---");
	const lines = text.slice(4, end).split("\n");
	for (let i = 0; i < lines.length; i++) {
		const m = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
		if (!m) {
			if (lines[i].trim()) throw new Error(`front matter: cannot parse "${lines[i]}"`);
			continue;
		}
		const [, key, value] = m;
		if (value === "|") {
			const block = [];
			while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1] === "")) block.push(lines[++i].replace(/^ {2}/, ""));
			meta[key] = block.join("\n").trim();
		} else if (value === "") {
			const list = [];
			while (i + 1 < lines.length && /^\s+- /.test(lines[i + 1])) list.push(lines[++i].replace(/^\s+- /, ""));
			meta[key] = list;
		} else meta[key] = value;
	}
	return { meta, body: text.slice(end + 5) };
}

/* ---------------------------------------------------------------- markdown */

const marked = new Marked({
	gfm: true,
	renderer: {
		code({ text, lang }) {
			const l = (lang ?? "").split(/\s/)[0];
			return `<pre${l && !CODE_LANGS.has(l) ? ` class="plain"` : ""}><code>${CODE_LANGS.has(l) ? highlight(text) : encode(text)}</code></pre>\n`;
		},
		heading({ tokens, depth }) {
			const inner = this.parser.parseInline(tokens);
			if (depth === 2) return `<h3 id="${slug(inner)}">${inner}</h3>\n`;
			return `<h4>${inner}</h4>\n`;
		},
	},
});
export const md = (s) => marked.parse(s);
export const mdInline = (s) => marked.parseInline(s ?? "");

/* -------------------------------------------------------------- directives */

export function parseHeader(rest) {
	const [flagText, ...titleParts] = rest.split("|");
	const flags = new Set();
	const opts = {};
	for (const f of flagText.trim().split(/\s+/).filter(Boolean)) {
		const kv = /^(\w+)=(.*)$/.exec(f);
		if (kv) opts[kv[1]] = kv[2];
		else flags.add(f);
	}
	return { flags, opts, title: titleParts.join("|").trim() };
}

export class Book {
	/** `prefix` keeps figure ids unique when several books share a page (walkthrough cards). */
	constructor(options = {}) {
		this.figures = options.start ?? 0;
		this.prefix = options.prefix ?? "f";
		this.usesRuntime = false;
	}

	figure(kind, header, body) {
		const n = ++this.figures;
		const animate = header.flags.has("animate");
		if (animate) this.usesRuntime = true;
		const label = header.title.replace(/[*`_]/g, "") || `Figure ${n}`;
		let inner;
		if (kind === "flow") inner = flow(body, { id: `${this.prefix}${n}`, label, animate });
		else if (kind === "sequence") inner = sequence(body, { id: `${this.prefix}${n}`, label, animate });
		else inner = /^\s*</.test(body) ? body : md(body);
		const cls = ["fig", header.flags.has("wide") ? "wide" : "", animate ? "anim" : ""].filter(Boolean).join(" ");
		const pace = header.opts.pace ? ` style="--pace:${Number.parseFloat(header.opts.pace)}s"` : "";
		const replay = animate ? `<button class="replay" type="button">Replay</button>` : "";
		const caption = header.title ? `<figcaption>${replay}<span class="fignum">Figure ${n}.</span> ${mdInline(header.title)}</figcaption>` : replay;
		return `<figure class="${cls}"${pace}>${inner}${caption}</figure>\n`;
	}

	directive(name, header, body) {
		switch (name) {
			case "note":
			case "review":
				return `<div class="note${name === "review" ? " review" : ""}">${header.title ? `<b class="tag">${mdInline(header.title)}</b>` : ""}${md(body)}</div>\n`;
			case "findings":
				return md(body).replace("<ol>", '<ol class="findings">');
			case "stats":
				return `<div class="stats">${this.stats(body)}</div>\n`;
			case "figure":
			case "flow":
			case "sequence":
				return this.figure(name, header, body);
			case "steps": {
				this.usesRuntime = true;
				const panels = body.split(/^\+\+\+[ \t]*/m).slice(1);
				if (!panels.length) throw new Error(`steps: no "+++ Step title" panels`);
				const html = panels
					.map((p) => {
						const nl = p.indexOf("\n");
						const title = nl < 0 ? p : p.slice(0, nl);
						return `<div class="step-panel"><h4>${mdInline(title.trim())}</h4>${this.blocks(nl < 0 ? "" : p.slice(nl + 1))}</div>`;
					})
					.join("");
				return `<div class="steps"><div class="steps-head"><span class="title">${mdInline(header.title || "Step by step")}</span><span class="count"></span><button class="prev" type="button">Back</button><button class="next" type="button">Next</button></div>${html}</div>\n`;
			}
			case "raw":
			case "html":
				return `${body}\n`;
			default:
				throw new Error(`unknown directive :::${name}`);
		}
	}

	stats(body) {
		return body
			.split("\n")
			.filter((l) => l.trim())
			.map((l) => {
				const [value, ...label] = l.replace(/^\s*-\s*/, "").split("|");
				return `<div class="stat"><b>${mdInline(value.trim())}</b><span>${mdInline(label.join("|").trim())}</span></div>`;
			})
			.join("");
	}

	/** Markdown with ::: directives (nestable). */
	blocks(text) {
		const lines = text.split("\n");
		let out = "";
		let chunk = [];
		let fence = null;
		const flush = () => {
			if (chunk.join("").trim()) out += md(chunk.join("\n"));
			chunk = [];
		};
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const f = /^\s*(```+|~~~+)/.exec(line);
			if (f) {
				if (!fence) fence = f[1];
				else if (line.trim().startsWith(fence)) fence = null;
			}
			const open = !fence && /^:::(\w+)(.*)$/.exec(line);
			if (!open) {
				chunk.push(line);
				continue;
			}
			flush();
			const [, name, rest] = open;
			const body = [];
			let depth = 1;
			let innerFence = null;
			for (i++; i < lines.length; i++) {
				const l = lines[i];
				const g = /^\s*(```+|~~~+)/.exec(l);
				if (g) {
					if (!innerFence) innerFence = g[1];
					else if (l.trim().startsWith(innerFence)) innerFence = null;
				}
				if (!innerFence && /^:::\w/.test(l)) depth++;
				else if (!innerFence && /^:::\s*$/.test(l) && --depth === 0) break;
				body.push(l);
			}
			if (depth !== 0) throw new Error(`:::${name} is not closed`);
			out += this.directive(name, parseHeader(rest), body.join("\n"));
		}
		flush();
		return out;
	}
}

/* -------------------------------------------------------------------- book */

export function parseHeading(line) {
	const m = /^#\s+(.*?)\s*(?:\{([^}]*)\})?\s*$/.exec(line);
	const attrs = { kind: "chapter", id: undefined, lede: undefined, nodrop: false };
	for (const a of (m[2] ?? "").matchAll(/#([\w-]+)|\.([\w-]+)|(\w+)="([^"]*)"/g)) {
		if (a[1]) attrs.id = a[1];
		else if (a[2] === "nodrop") attrs.nodrop = true;
		else if (a[2]) attrs.kind = a[2];
		else attrs[a[3]] = a[4];
	}
	return { title: m[1], ...attrs };
}

export function sections(body) {
	const out = [];
	let fence = null;
	let directive = 0;
	for (const line of body.split("\n")) {
		const f = /^\s*(```+|~~~+)/.exec(line);
		if (f) {
			if (!fence) fence = f[1];
			else if (line.trim().startsWith(fence)) fence = null;
		}
		if (!fence && /^:::\w/.test(line)) directive++;
		else if (!fence && /^:::\s*$/.test(line)) directive--;
		if (!fence && !directive && /^#\s/.test(line)) out.push({ ...parseHeading(line), text: "" });
		else if (out.length) out.at(-1).text += `${line}\n`;
		else if (line.trim()) throw new Error(`content before the first "# " heading: ${line}`);
	}
	return out;
}

