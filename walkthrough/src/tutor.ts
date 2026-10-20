// The tutor: one Durable extension with the walkthrough's prompt sections, read-only tools over the bundled sources,
// the render tool for figures, and the progress document.
import { Type } from "@earendil-works/pi-ai";
import { defineDoc, defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { FORMAT_GUIDE, TEACHING_RULES } from "./prompt.ts";

export interface Concept {
	id: string;
	title: string;
	notes: string;
	checks: { question: string; answer: string }[];
}

export interface WalkthroughData {
	title: string;
	subtitle?: string;
	tutor: string;
	truth?: string;
	concepts: Concept[];
	sources: Record<string, string>;
	model?: { provider: string; modelId: string };
}

export type ConceptStatus = "started" | "done";
export type Progress = {
	concepts: Record<string, { status: ConceptStatus; note?: string }>;
	grades: { concept: string; question: string; verdict: "correct" | "partial" | "wrong"; note?: string }[];
};

export const ProgressDoc = defineDoc<Progress>({
	kind: "walkthrough.progress",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "current",
	initial: () => ({ concepts: {}, grades: [] }),
	checkpointWhen: () => true,
});

/** Renders card Markdown off screen and reports build errors and layout problems. */
export type CardChecker = (markdown: string) => { problems: string[] };

const text = (value: string) => ({ output: [{ type: "text" as const, text: value }] });

function globToRegExp(glob: string): RegExp {
	let re = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === "*" && glob[i + 1] === "*") {
			re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
			i += glob[i + 2] === "/" ? 2 : 1;
		} else if (c === "*") re += "[^/]*";
		else if (c === "?") re += "[^/]";
		else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${re}$`);
}

const clean = (path: string) => path.replace(/^\.?\/+/, "").replace(/\/+$/, "");

export function createTutor(data: WalkthroughData, checkCard: CardChecker) {
	const paths = Object.keys(data.sources).sort();

	const read = defineTool({
		name: "read",
		description:
			"Read a bundled source file. Returns numbered lines. Use offset (1-based line) and limit for large files.",
		parameters: Type.Object({
			path: Type.String(),
			offset: Type.Optional(Type.Number({ minimum: 1 })),
			limit: Type.Optional(Type.Number({ minimum: 1, maximum: 2000 })),
		}),
		replay: "safe",
		execute: async ({ path, offset = 1, limit = 400 }) => {
			const file = data.sources[clean(path)];
			if (file === undefined) throw new Error(`No such file: ${path}. Use ls or find.`);
			const lines = file.split("\n");
			const end = Math.min(lines.length, offset - 1 + limit);
			const body = lines
				.slice(offset - 1, end)
				.map((line, i) => `${offset + i}: ${line}`)
				.join("\n");
			const more = end < lines.length ? `\n[lines ${offset}-${end} of ${lines.length}; continue with offset=${end + 1}]` : "";
			return text(body + more);
		},
	});

	const ls = defineTool({
		name: "ls",
		description: "List a directory of the bundled sources (empty path: the root).",
		parameters: Type.Object({ path: Type.Optional(Type.String()) }),
		replay: "safe",
		execute: async ({ path = "" }) => {
			const dir = clean(path);
			const prefix = dir ? `${dir}/` : "";
			const names = new Set<string>();
			for (const p of paths) {
				if (!p.startsWith(prefix)) continue;
				const rest = p.slice(prefix.length);
				const slash = rest.indexOf("/");
				names.add(slash < 0 ? rest : `${rest.slice(0, slash)}/`);
			}
			if (!names.size) throw new Error(`No such directory: ${path}`);
			return text([...names].sort().join("\n"));
		},
	});

	const find = defineTool({
		name: "find",
		description: "Find bundled source files by glob, for example **/*.ts or docs/*.md.",
		parameters: Type.Object({ pattern: Type.String() }),
		replay: "safe",
		execute: async ({ pattern }) => {
			const re = globToRegExp(clean(pattern));
			const hits = paths.filter((p) => re.test(p) || re.test(p.split("/").pop() ?? ""));
			return text(hits.length ? hits.slice(0, 500).join("\n") : "No files match.");
		},
	});

	const grep = defineTool({
		name: "grep",
		description:
			"Search the bundled sources with a JavaScript regular expression. Optional glob limits the files. Returns path:line: text, at most 100 matches.",
		parameters: Type.Object({
			pattern: Type.String(),
			glob: Type.Optional(Type.String()),
			ignoreCase: Type.Optional(Type.Boolean()),
		}),
		replay: "safe",
		execute: async ({ pattern, glob, ignoreCase }) => {
			const re = new RegExp(pattern, ignoreCase ? "i" : "");
			const only = glob ? globToRegExp(clean(glob)) : undefined;
			const out: string[] = [];
			for (const p of paths) {
				if (only && !only.test(p)) continue;
				const lines = data.sources[p].split("\n");
				for (let i = 0; i < lines.length && out.length < 100; i++)
					if (re.test(lines[i])) out.push(`${p}:${i + 1}: ${lines[i].slice(0, 300)}`);
				if (out.length >= 100) break;
			}
			return text(out.length ? out.join("\n") : "No matches.");
		},
	});

	const render = defineTool({
		name: "render",
		description:
			"Show the learner a card: explainer Markdown with directives (:::sequence, :::flow, :::steps, :::note, :::stats, code fences). Returns layout problems to fix; on problems the card is not shown, so fix and call again.",
		parameters: Type.Object({ markdown: Type.String() }),
		replay: "safe",
		execute: async ({ markdown }) => {
			const { problems } = checkCard(markdown);
			if (problems.length) return { ...text(`Not shown. Fix and render again:\n- ${problems.join("\n- ")}`), isError: true };
			return { ...text("Shown to the learner."), details: { markdown } };
		},
	});

	const progress = defineTool({
		name: "progress",
		description: "Record that a concept was started or is done (after its check questions were answered well).",
		parameters: Type.Object({
			concept: Type.String(),
			status: Type.Union([Type.Literal("started"), Type.Literal("done")]),
			note: Type.Optional(Type.String()),
		}),
		replay: "safe",
		execute: async ({ concept, status, note }, api, context) => {
			if (!data.concepts.some((c) => c.id === concept)) throw new Error(`Unknown concept id: ${concept}`);
			await api.commit(async (tx) => {
				(await tx.doc(ProgressDoc, api.conversationId)).concepts[concept] = note ? { status, note } : { status };
			}, context);
			return text(`${concept}: ${status}`);
		},
	});

	const grade = defineTool({
		name: "grade",
		description: "Record your verdict on the learner's answer to a check question.",
		parameters: Type.Object({
			concept: Type.String(),
			question: Type.String(),
			verdict: Type.Union([Type.Literal("correct"), Type.Literal("partial"), Type.Literal("wrong")]),
			note: Type.Optional(Type.String()),
		}),
		replay: "safe",
		execute: async ({ concept, question, verdict, note }, api, context) => {
			await api.commit(async (tx) => {
				(await tx.doc(ProgressDoc, api.conversationId)).grades.push(note ? { concept, question, verdict, note } : { concept, question, verdict });
			}, context);
			return text(`recorded: ${verdict}`);
		},
	});

	const outline = data.concepts
		.map((c, i) => {
			const checks = c.checks.length
				? `\nCheck questions (ask them; the answers are for you only):\n${c.checks.map((q, j) => `${j + 1}. ${q.question}\n   Answer: ${q.answer}`).join("\n")}`
				: "";
			return `## ${i + 1}. ${c.title} (id: ${c.id})\n${c.notes.trim()}${checks}`;
		})
		.join("\n\n");
	const sourceList = paths.map((p) => `${p} (${data.sources[p].split("\n").length} lines)`).join("\n");

	return defineExtension({
		name: "walkthrough",
		tools: [read, ls, find, grep, render, progress, grade],
		sections: [
			section("walkthrough", () =>
				[
					`You are the tutor of an interactive walkthrough: "${data.title}".`,
					TEACHING_RULES,
					`Author's instructions:\n${data.tutor.trim()}`,
					data.truth ? `Which source wins when sources disagree: ${data.truth}` : "",
				]
					.filter(Boolean)
					.join("\n\n"),
			),
			section("format", () => FORMAT_GUIDE),
			section("outline", () => outline),
			section("sources", () => `Bundled files (read with read, ls, find, grep):\n${sourceList}`),
		],
	});
}
