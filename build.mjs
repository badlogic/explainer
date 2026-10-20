#!/usr/bin/env node
// Build a book-style explainer, or a walkthrough page (front matter `kind: walkthrough`), from Markdown.
// Usage: node build.mjs book.md [-o out.html]
// See SKILL.md for the format (front matter, chapters, directives, diagrams, escape hatches).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activate, Book, encode, frontMatter, md, mdInline, ROMAN, sections, slug } from "./lib/render.mjs";
import { buildWalkthrough } from "./lib/walkthrough.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(path.join(HERE, "book.css"), "utf8");
export function build(source) {
	const { meta, body } = frontMatter(source);
	const book = new Book();
	const secs = sections(body);
	let chapter = 0;
	let appendix = 0;
	for (const s of secs) {
		s.id ??= slug(s.title);
		if (s.kind === "chapter") s.numeral = ROMAN[chapter++];
		else if (s.kind === "appendix") s.numeral = String.fromCharCode(65 + appendix++);
		else if (s.kind === "epilogue") s.numeral = "∴";
		s.html = book.blocks(s.text);
		if (!s.nodrop && s.kind !== "appendix" && s.html.trimStart().startsWith("<p>")) s.html = s.html.replace("<p>", '<p class="dropcap">');
	}

	const title = meta.title ?? "Untitled";
	const coverLines = (meta.cover ?? title).split(" / ").map(encode).join("<br>");
	const stats = Array.isArray(meta.stats) && meta.stats.length ? `<div class="cover-stats">${book.stats(meta.stats.join("\n"))}</div>` : "";
	const toc = secs
		.map((s) => {
			const label =
				s.kind === "chapter" ? `${s.numeral}. ${mdInline(s.title)}` : s.kind === "appendix" ? `Appendix ${s.numeral}: ${mdInline(s.title)}` : mdInline(s.title);
			return `<li><a href="#${s.id}">${label}</a></li>`;
		})
		.join("\n");
	const sectionHtml = secs
		.map((s) => {
			if (s.kind === "preface") return `<section class="preface" id="${s.id}">\n<h2>${mdInline(s.title)}</h2>\n${s.html}</section>`;
			const cls = s.kind === "chapter" ? "chapter" : `chapter ${s.kind}`;
			const lede = s.lede ? `<p class="lede">${mdInline(s.lede)}</p>` : "";
			return `<section class="${cls}" id="${s.id}"><header class="opener"><div class="numeral">${s.numeral}</div><h2>${mdInline(s.title)}</h2>${lede}</header>\n${s.html}</section>`;
		})
		.join("\n\n");
	const scripts = Array.isArray(meta.scripts) ? meta.scripts.map((u) => `<script src="${encode(u)}"></script>`).join("\n") : "";

	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${encode(meta["page-title"] ?? title)}</title>
<style>
${CSS}</style>
${scripts}
${meta.head ?? ""}
</head>
<body><div class="book">
<section class="cover">
  <div class="kicker">${mdInline(meta.kicker ?? "")}</div>
  <h1>${coverLines}</h1>
  ${meta.subtitle ? `<p class="subtitle">${mdInline(meta.subtitle)}</p>` : ""}
  ${stats}
  ${meta.note ? `<div class="cover-note">${md(meta.note)}</div>` : ""}
</section><div class="inner">
${meta.toc === "false" ? "" : `<nav class="toc"><h2>Contents</h2><ol>\n${toc}\n</ol></nav>`}

${sectionHtml}

${meta.colophon ? `<p class="colophon">${mdInline(meta.colophon)}</p>` : ""}
</div></div>
${book.usesRuntime ? `<script>(${activate.toString()})(document)</script>` : ""}
</body></html>
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const input = args.find((a) => !a.startsWith("-") && args[args.indexOf(a) - 1] !== "-o");
	if (!input) {
		console.error("usage: node build.mjs book.md [-o out.html]");
		process.exit(1);
	}
	const o = args.indexOf("-o");
	const output = o >= 0 ? args[o + 1] : input.replace(/\.md$/, "") + ".html";
	try {
		const source = readFileSync(input, "utf8");
		if (frontMatter(source).meta.kind === "walkthrough") {
			const runtimePath = path.join(HERE, "walkthrough/dist/runtime.js");
			const css = CSS + readFileSync(path.join(HERE, "walkthrough/walkthrough.css"), "utf8");
			const { html, stats } = buildWalkthrough(source, { cwd: process.cwd(), css, runtime: readFileSync(runtimePath, "utf8") });
			writeFileSync(output, html);
			const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
			console.log(
				`wrote ${output} (${kb(Buffer.byteLength(html))}): ${stats.concepts} concepts, ${stats.checks} check questions, ${stats.files} source files (${kb(stats.sourceBytes)})`,
			);
		} else {
			writeFileSync(output, build(source));
			console.log(`wrote ${output}`);
		}
	} catch (error) {
		console.error(`${input}: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
