// Builds a walkthrough page: the shell, the prebuilt runtime (walkthrough/dist/runtime.js) and a JSON blob with the
// outline, the tutor rules and the bundled sources.
import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Book, encode, frontMatter, mdInline, sections, slug } from "./render.mjs";

const SECRET_NAME = /(^\.env(\..*)?$)|(^id_(rsa|ed25519|ecdsa|dsa)$)|(\.(pem|key|p12|pfx|keystore)$)|(^\.npmrc$)|(^auth\.json$)/i;
const SECRET_TEXT = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/** Extracts top-level `:::name` blocks (directives nest; fences are skipped) and returns their bodies and the rest. */
function block(text, name) {
	const lines = text.split("\n");
	const bodies = [];
	const rest = [];
	let fence = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const f = /^\s*(```+|~~~+)/.exec(line);
		if (f) {
			if (!fence) fence = f[1];
			else if (line.trim().startsWith(fence)) fence = null;
		}
		if (fence || !new RegExp(`^:::${name}(\\s|\\||$)`).test(line)) {
			rest.push(line);
			continue;
		}
		const body = [];
		let depth = 1;
		let inner = null;
		for (i++; i < lines.length; i++) {
			const l = lines[i];
			const g = /^\s*(```+|~~~+)/.exec(l);
			if (g) {
				if (!inner) inner = g[1];
				else if (l.trim().startsWith(inner)) inner = null;
			}
			if (!inner && /^:::\w/.test(l)) depth++;
			else if (!inner && /^:::\s*$/.test(l) && --depth === 0) break;
			body.push(l);
		}
		if (depth !== 0) throw new Error(`:::${name} is not closed`);
		bodies.push(body.join("\n"));
	}
	return { bodies, rest: rest.join("\n") };
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
	const intro = block(tutor.rest, "intro");
	const firstHeading = intro.rest.search(/^#\s/m);
	if (firstHeading < 0) throw new Error("a walkthrough needs at least one concept (# heading)");
	if (intro.rest.slice(0, firstHeading).trim()) throw new Error("content before the first concept other than :::tutor and :::intro");
	let part;
	const concepts = sections(intro.rest.slice(firstHeading)).map((s) => {
		const { bodies, rest } = block(s.text, "check");
		part = s.part ?? part;
		return { id: s.id ?? slug(s.title), title: s.title, part, notes: rest.trim(), checks: bodies.flatMap(checks) };
	});
	const introMarkdown = intro.bodies.join("\n\n");
	const introBook = new Book({ prefix: "i" });
	const introHtml = introMarkdown ? introBook.blocks(introMarkdown) : "";
	const sources = collectSources(Array.isArray(meta.sources) ? meta.sources : [], cwd);
	const [provider, ...model] = (meta.model ?? "").split("/");
	const data = {
		title: meta.title ?? "Walkthrough",
		subtitle: meta.subtitle,
		tutor: tutor.bodies.join("\n\n"),
		intro: introMarkdown || undefined,
		introFigures: introBook.figures,
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
  <button id="wt-reset" class="wt-btn subtle" type="button">Start over</button>
</aside>
<main class="wt-main">
  <header class="wt-bar"><button id="wt-outline-btn" class="wt-btn subtle" type="button">Outline</button><span class="wt-spacer"></span><select id="wt-model"></select><button id="wt-login" class="wt-btn" type="button">Sign in</button></header>
  <div id="wt-boot">Loading the tutor…</div>
  <section id="wt-start">
    <h2>${title}</h2>
    ${data.subtitle ? `<p class="subtitle">${mdInline(data.subtitle)}</p>` : ""}
    ${introHtml}
    <h4>How this works</h4>
    <p>A tutor takes you through ${concepts.length} concepts in order, one at a time: it explains with an example and a figure, then asks a check question and waits for your answer. Answer in your own words, or ask anything at any point. The outline shows where you are.</p>
    <div id="wt-concepts"></div>
    <button id="wt-start-btn" class="wt-btn primary" type="button">Start</button>
  </section>
  <div id="wt-transcript"></div>
  <div id="wt-live"></div>
  <div class="wt-composer"><div class="wt-compose-box"><textarea id="wt-input" rows="1" placeholder="Answer, or ask anything"></textarea><button id="wt-send" type="button">Send</button></div><div class="wt-compose-hint">Enter sends · Shift+Enter adds a line</div></div>
</main>
<div id="measure" class="wt-measure book"></div>
<script type="application/json" id="walkthrough-data">${json}</script>
<script type="module">${script}</script>
</body></html>
`;
	return { html, stats };
}
