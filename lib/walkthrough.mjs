// Builds a walkthrough page: the shell, the prebuilt runtime (walkthrough/dist/runtime.js) and a JSON blob with the
// outline, the tutor rules and the bundled sources.
import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { encode, frontMatter, mdInline, sections, slug } from "./render.mjs";

const SECRET_NAME = /(^\.env(\..*)?$)|(^id_(rsa|ed25519|ecdsa|dsa)$)|(\.(pem|key|p12|pfx|keystore)$)|(^\.npmrc$)|(^auth\.json$)/i;
const SECRET_TEXT = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

function block(text, name) {
	const re = new RegExp(`^:::${name}[^\\n]*\\n([\\s\\S]*?)^:::[ \\t]*$`, "gm");
	const bodies = [];
	const rest = text.replace(re, (_m, body) => {
		bodies.push(body);
		return "";
	});
	return { bodies, rest };
}

function numbered(text) {
	const items = [];
	for (const line of text.split("\n")) {
		const m = /^\s*\d+[.)]\s+(.*)$/.exec(line);
		if (m) items.push(m[1]);
		else if (line.trim() && items.length) items[items.length - 1] += ` ${line.trim()}`;
	}
	return items;
}

function checks(body) {
	const [questions, answers = ""] = body.split(/^\+\+\+\s*answers\s*$/im);
	const q = numbered(questions);
	const a = numbered(answers);
	return q.map((question, i) => ({ question, answer: a[i] ?? "" }));
}

function collectSources(patterns, cwd) {
	const files = new Map();
	for (const pattern of patterns) {
		const matches = existsSync(path.resolve(cwd, pattern)) ? [pattern] : globSync(pattern, { cwd });
		if (!matches.length) throw new Error(`sources: nothing matches ${pattern}`);
		for (const match of matches) {
			const abs = path.resolve(cwd, match);
			if (!statSync(abs).isFile()) continue;
			const rel = path.relative(cwd, abs).split(path.sep).join("/");
			if (SECRET_NAME.test(path.basename(rel))) throw new Error(`sources: refusing secret-looking file ${rel}`);
			const text = readFileSync(abs, "utf8");
			if (SECRET_TEXT.test(text)) throw new Error(`sources: refusing ${rel}, it contains a private key`);
			if (text.includes("\u0000")) continue;
			files.set(rel, text);
		}
	}
	return Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)));
}

export function buildWalkthrough(source, { cwd, css, runtime }) {
	const { meta, body } = frontMatter(source);
	const tutor = block(body, "tutor");
	const firstHeading = tutor.rest.search(/^#\s/m);
	if (firstHeading < 0) throw new Error("a walkthrough needs at least one concept (# heading)");
	if (tutor.rest.slice(0, firstHeading).trim()) throw new Error("content before the first concept other than :::tutor");
	const concepts = sections(tutor.rest.slice(firstHeading)).map((s) => {
		const { bodies, rest } = block(s.text, "check");
		return { id: s.id ?? slug(s.title), title: s.title, notes: rest.trim(), checks: bodies.flatMap(checks) };
	});
	const sources = collectSources(Array.isArray(meta.sources) ? meta.sources : [], cwd);
	const [provider, ...model] = (meta.model ?? "").split("/");
	const data = {
		title: meta.title ?? "Walkthrough",
		subtitle: meta.subtitle,
		tutor: tutor.bodies.join("\n\n"),
		truth: meta.truth,
		concepts,
		sources,
		model: provider && model.length ? { provider, modelId: model.join("/") } : undefined,
	};
	const json = JSON.stringify(data).replace(/</g, "\\u003c");
	const script = runtime.replace(/<\/script/gi, "<\\/script");
	const stats = {
		concepts: concepts.length,
		checks: concepts.reduce((n, c) => n + c.checks.length, 0),
		files: Object.keys(sources).length,
		sourceBytes: Object.values(sources).reduce((n, t) => n + Buffer.byteLength(t), 0),
	};
	const title = encode(data.title);
	const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
${css}</style>
</head>
<body class="wt">
<aside class="wt-rail">
  <div class="kicker">${mdInline(meta.kicker ?? "Walkthrough")}</div>
  <h1>${title}</h1>
  ${data.subtitle ? `<p class="subtitle">${mdInline(data.subtitle)}</p>` : ""}
  <ol id="wt-outline"></ol>
  <div id="wt-score"></div>
</aside>
<main class="wt-main">
  <header class="wt-bar"><select id="wt-model"></select><button id="wt-login" class="wt-btn" type="button">Sign in</button></header>
  <div id="wt-boot">Loading the tutor…</div>
  <section id="wt-start">
    <h2>${title}</h2>
    ${data.subtitle ? `<p class="subtitle">${mdInline(data.subtitle)}</p>` : ""}
    <p>A tutor walks you through ${concepts.length} concepts, one at a time, with figures and check questions. Ask anything along the way.</p>
    <ol id="wt-concepts"></ol>
    <button id="wt-start-btn" class="wt-btn primary" type="button">Start</button>
  </section>
  <div id="wt-transcript"></div>
  <div id="wt-live"></div>
  <div class="wt-composer"><textarea id="wt-input" placeholder="Answer or ask a question. Enter sends, Shift+Enter adds a line."></textarea><button id="wt-send" class="wt-btn primary" type="button">Send</button></div>
</main>
<div id="measure" class="wt-measure book"></div>
<script type="application/json" id="walkthrough-data">${json}</script>
<script type="module">${script}</script>
</body></html>
`;
	return { html, stats };
}
