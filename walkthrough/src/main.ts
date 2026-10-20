// Walkthrough page runtime: a pi-durable Harness in the browser, pi-ai login, and the transcript UI.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type AuthEvent, type AuthPrompt, createModels, type Api, type Model } from "@earendil-works/pi-ai";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { activate, Book, encode, md } from "../../lib/render.mjs";
import { IndexedDbCredentialStore } from "./credentials.ts";
import { deliverCallback, hasListeningServer } from "./stubs/http.ts";
import { IndexedDbStorage } from "./vendor/indexeddb-storage.ts";
import { createTutor, type Progress, ProgressDoc, type WalkthroughData } from "./tutor.ts";

type Json = Record<string, unknown>;
type Entry = { id: number; kind: string; model?: Json[] };
type View = { entries: readonly Entry[]; docs: Record<string, Json> };

const ctx = BACKGROUND_CONTEXT;
/** Sign-ins measured to fail from a web page: the provider's token, device-code or model endpoint sends no CORS headers. */
const BLOCKED: Record<string, string> = {
	"anthropic:oauth": "the token exchange is blocked for web pages",
	"openai-codex:oauth": "the Codex model endpoint is blocked for web pages",
	"github-copilot:oauth": "the device-code endpoint is blocked for web pages",
	"xai:oauth": "the device-code endpoint is blocked for web pages",
	"openai:oauth": "OpenAI drops CORS headers for ChatGPT tokens",
};
/** Listed first: sign-ins that work from a web page. */
const FIRST = ["radius", "anthropic", "openai", "openrouter"];
const PREFERRED: Record<string, string[]> = {
	radius: ["claude-sonnet-5-5", "claude-sonnet-5", "claude-opus-5-5", "balanced"],
	anthropic: ["claude-sonnet-5-5", "claude-sonnet-5", "claude-opus-5-5", "claude-sonnet-4-6"],
	openai: ["gpt-6-sol", "gpt-5.5", "gpt-5.1", "gpt-5"],
	openrouter: ["anthropic/claude-sonnet-5-5", "anthropic/claude-sonnet-4.5"],
	google: ["gemini-3.5-pro", "gemini-3-pro", "gemini-2.5-pro"],
};

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const el = (tag: string, cls?: string, html?: string) => {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (html !== undefined) e.innerHTML = html;
	return e;
};

/* ------------------------------------------------------------------ cards */

let cardSeq = 0;
let figures = 0;
let sources: Record<string, string> = {};

/** `path:line` or `path:12-40` in code spans becomes a link that opens the bundled file at that line. */
function linkCitations(root: HTMLElement) {
	const paths = Object.keys(sources);
	for (const code of root.querySelectorAll("code")) {
		if (code.closest("pre")) continue;
		const m = /^([\w./-]+\.[\w]+)(?::(\d+)(?:[-–](\d+))?)?$/.exec(code.textContent?.trim() ?? "");
		if (!m) continue;
		const exact = paths.find((p) => p === m[1]);
		const suffix = paths.filter((p) => p.endsWith(`/${m[1]}`));
		const path = exact ?? (suffix.length === 1 ? suffix[0] : undefined);
		if (!path) continue;
		const from = m[2] ? Number(m[2]) : 1;
		const to = m[3] ? Number(m[3]) : m[2] ? from : 0;
		code.classList.add("wt-cite");
		code.title = `Open ${path}`;
		code.onclick = () => openSource(path, from, to);
	}
}

function openSource(path: string, from: number, to: number) {
	const { body } = dialog(path);
	body.parentElement?.classList.add("wt-source");
	const lines = (sources[path] ?? "").split("\n");
	const pre = el("pre", "wt-source-text");
	pre.innerHTML = lines
		.map((line, i) => `<span class="ln${i + 1 >= from && i + 1 <= to ? " hl" : ""}" data-n="${i + 1}">${encode(line) || " "}</span>`)
		.join("");
	body.append(pre);
	requestAnimationFrame(() => pre.querySelector(`[data-n="${Math.max(1, from - 3)}"]`)?.scrollIntoView({ block: "start" }));
}
/** Figures are numbered across the whole transcript, in display order. */
function renderMarkdown(markdown: string, prefix: string): string {
	const book = new Book({ prefix, start: figures });
	try {
		const html = book.blocks(markdown);
		figures = book.figures;
		return html;
	} catch {
		return md(markdown);
	}
}

/** Layout check for the render tool: build errors and SVG text leaving its box or the figure. */
function checkCard(markdown: string): { problems: string[] } {
	let html: string;
	try {
		html = new Book({ prefix: `m${++cardSeq}_` }).blocks(markdown);
	} catch (error) {
		return { problems: [`build error: ${error instanceof Error ? error.message : String(error)}`] };
	}
	const host = $("#measure");
	host.innerHTML = html;
	const problems: string[] = [];
	host.querySelectorAll(".step-panel").forEach((p) => p.classList.add("on"));
	host.querySelectorAll("svg").forEach((svg, i) => {
		const vb = (svg as SVGSVGElement).viewBox.baseVal;
		const rects = [...svg.querySelectorAll("rect")].filter((r) => r.getAttribute("fill") !== "#fbf8f2").map((r) => r.getBBox());
		svg.querySelectorAll("text").forEach((t) => {
			const bb = (t as SVGTextElement).getBBox();
			if (vb && (bb.x < 0 || bb.x + bb.width > vb.width)) problems.push(`figure ${i + 1}: "${t.textContent}" leaves the figure; shorten it`);
			const cx = bb.x + bb.width / 2;
			const cy = bb.y + bb.height / 2;
			const box = rects.find((r) => cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height);
			if (box && (bb.x < box.x + 1 || bb.x + bb.width > box.x + box.width - 1))
				problems.push(`figure ${i + 1}: "${t.textContent}" overflows its box; shorten it`);
		});
	});
	host.innerHTML = "";
	return { problems: [...new Set(problems)] };
}

/* ------------------------------------------------------------------ login */

function dialog(title: string): { body: HTMLElement; close: () => void } {
	const back = el("div", "wt-modal");
	const box = el("div", "wt-dialog", `<div class="wt-dialog-head"><b>${encode(title)}</b><button class="wt-x" type="button">Close</button></div>`);
	const body = el("div", "wt-dialog-body");
	box.append(body);
	back.append(box);
	document.body.append(back);
	const close = () => back.remove();
	(box.querySelector(".wt-x") as HTMLButtonElement).onclick = close;
	return { body, close };
}

function askPrompt(body: HTMLElement, prompt: AuthPrompt): Promise<string> {
	return new Promise((resolve, reject) => {
		if (prompt.type === "manual_code") body.querySelector(".wt-paste")?.remove();
		const row = el("div", "wt-prompt", `<p>${encode(prompt.message)}</p>`);
		body.append(row);
		prompt.signal?.addEventListener("abort", () => row.remove(), { once: true });
		if (prompt.type === "select") {
			for (const option of prompt.options) {
				const b = el("button", "wt-btn", `${encode(option.label)}${option.description ? `<small>${encode(option.description)}</small>` : ""}`);
				b.onclick = () => {
					row.remove();
					resolve(option.id);
				};
				row.append(b);
			}
			return;
		}
		const input = el("input", "wt-input") as HTMLInputElement;
		input.type = prompt.type === "secret" ? "password" : "text";
		input.placeholder = prompt.placeholder ?? "";
		const ok = el("button", "wt-btn primary", "Continue");
		const submit = () => {
			if (!input.value.trim()) return;
			row.remove();
			resolve(input.value.trim());
		};
		ok.onclick = submit;
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") submit();
		});
		row.append(input, ok);
		input.focus();
		void reject;
	});
}

function showEvent(body: HTMLElement, event: AuthEvent) {
	if (event.type === "auth_url") {
		const row = el(
			"div",
			"wt-event",
			`<p>${encode(event.instructions ?? "Sign in in the new tab.")}</p><a class="wt-btn primary" target="_blank" rel="noopener" href="${encode(event.url)}">Open sign-in page</a><p class="wt-hint">After signing in, the browser tries to open a <code>localhost</code> address and fails to load it. That is expected: copy that address from the address bar and paste it below.</p>`,
		);
		body.append(row);
		// Flows that only wait for their localhost callback (Radius) get a paste field that delivers the URL to it.
		// Flows that ask for the URL themselves replace it with their own prompt.
		queueMicrotask(() => {
			if (!hasListeningServer() || body.querySelector(".wt-prompt")) return;
			const paste = el("div", "wt-prompt wt-paste", "<p>Paste the <code>localhost</code> address here:</p>");
			const input = el("input", "wt-input") as HTMLInputElement;
			input.placeholder = "http://127.0.0.1:…/…?code=…";
			const ok = el("button", "wt-btn primary", "Continue");
			const error = el("p", "wt-hint");
			const submit = async () => {
				if (!input.value.trim()) return;
				ok.textContent = "Signing in…";
				try {
					const result = await deliverCallback(input.value);
					if (result.status >= 400) {
						const page = new DOMParser().parseFromString(result.body, "text/html");
						page.querySelectorAll("style,script").forEach((n) => n.remove());
						error.textContent = (page.body.textContent ?? "").replace(/\s+/g, " ").trim();
					}
					else paste.remove();
				} catch (failure) {
					error.textContent = failure instanceof Error ? failure.message : String(failure);
				}
				ok.textContent = "Continue";
			};
			ok.onclick = () => void submit();
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") void submit();
			});
			paste.append(input, ok, error);
			body.append(paste);
		});
	} else if (event.type === "device_code") {
		body.append(
			el("div", "wt-event", `<p>Enter <code>${encode(event.userCode)}</code> at <a target="_blank" rel="noopener" href="${encode(event.verificationUri)}">${encode(event.verificationUri)}</a></p>`),
		);
	} else if (event.type === "info") {
		body.append(el("div", "wt-event", `<p>${encode(event.message)}</p>`));
	} else if (event.type === "progress" && !event.message.startsWith("Listening")) {
		body.append(el("div", "wt-event wt-hint", `<p>${encode(event.message)}</p>`));
	}
}

/* ------------------------------------------------------------------- boot */

async function main() {
	const data = JSON.parse(($("#walkthrough-data") as HTMLScriptElement).textContent ?? "{}") as WalkthroughData;
	sources = data.sources;
	figures = data.introFigures ?? 0;
	activate($("#wt-start"));
	registerBunOAuthFlows();
	const credentials = await IndexedDbCredentialStore.open("walkthrough-credentials");
	const models = createModels({ credentials });
	for (const provider of builtinProviders()) models.setProvider(provider);

	const registry = createRegistry();
	registry.install(createTutor(data, checkCard));
	// One database per walkthrough. Durable allows one owner per storage, so a Web Lock keeps a second tab out.
	const dbName = `walkthrough-session:${data.title}`;
	if (!(await holdLock(dbName))) {
		$("#wt-boot").textContent = "This walkthrough is open in another tab. Close it there, then reload this page.";
		return;
	}
	void navigator.storage?.persist?.();
	const harness = await Harness.open(await IndexedDbStorage.open(dbName), { models, registry }, ctx);
	harness.resume();
	$("#wt-reset").onclick = async () => {
		if (!confirm("Start over? This deletes the conversation and your progress in this browser.")) return;
		await harness.close(ctx);
		await IndexedDbStorage.delete(dbName);
		location.reload();
	};

	const modelKey = "walkthrough:model";
	let chosen = JSON.parse(localStorage.getItem(modelKey) ?? "null") as { provider: string; modelId: string } | null;

	async function availableModels(): Promise<Model<Api>[]> {
		const out: Model<Api>[] = [];
		for (const { providerId } of await credentials.list()) out.push(...models.getModels(providerId));
		return out;
	}

	async function pickModel(): Promise<{ provider: string; modelId: string } | null> {
		const available = await availableModels();
		const has = (want: { provider: string; modelId: string } | null | undefined) =>
			want ? available.some((m) => m.provider === want.provider && m.id === want.modelId) : false;
		if (has(chosen)) return chosen;
		if (has(data.model)) return data.model ?? null;
		for (const [provider, ids] of Object.entries(PREFERRED))
			for (const id of ids) if (available.some((m) => m.provider === provider && m.id === id)) return { provider, modelId: id };
		const first = available[0];
		return first ? { provider: first.provider, modelId: first.id } : null;
	}

	const root = await harness.root(ctx);
	async function applyModel() {
		const model = await pickModel();
		chosen = model;
		if (model) {
			localStorage.setItem(modelKey, JSON.stringify(model));
			await root.configure({ model }, ctx);
		}
		await renderModelSelect();
	}

	/* ---- header */
	const select = $<HTMLSelectElement>("#wt-model");
	async function renderModelSelect() {
		const available = await availableModels();
		select.innerHTML = available.length
			? available.map((m) => `<option value="${encode(`${m.provider}/${m.id}`)}">${encode(`${m.provider} · ${m.name ?? m.id}`)}</option>`).join("")
			: `<option>Sign in to choose a model</option>`;
		select.disabled = !available.length;
		if (chosen) select.value = `${chosen.provider}/${chosen.modelId}`;
	}
	select.onchange = async () => {
		const [provider, ...rest] = select.value.split("/");
		chosen = { provider, modelId: rest.join("/") };
		localStorage.setItem(modelKey, JSON.stringify(chosen));
		await root.configure({ model: chosen }, ctx);
	};

	$("#wt-login").onclick = () => openLogin();
	$("#wt-outline-btn").onclick = (e) => {
		e.stopPropagation();
		document.body.classList.toggle("wt-rail-open");
	};
	$(".wt-main").addEventListener("click", () => document.body.classList.remove("wt-rail-open"));
	$(".wt-rail").onclick = (e) => {
		if ((e.target as HTMLElement).closest("#wt-outline")) document.body.classList.remove("wt-rail-open");
	};
	async function openLogin() {
		const { body, close } = dialog("Sign in to a model provider");
		await renderProviders(body, close);
	}

	async function renderProviders(body: HTMLElement, close: () => void) {
		body.innerHTML = "";
		const stored = new Set((await credentials.list()).map((c) => c.providerId));
		body.append(
			el(
				"p",
				"wt-hint",
				"Credentials stay in this browser; requests go from this page straight to the provider. Some providers block requests from web pages (CORS); their sign-in or first message then fails with a network error.",
			),
		);
		const rank = (id: string) => (stored.has(id) ? -10 : 0) + (FIRST.includes(id) ? FIRST.indexOf(id) - FIRST.length : 0);
		const providers = [...models.getProviders()].sort(
			(a, b) => rank(a.id) - rank(b.id) || (a.name ?? a.id).localeCompare(b.name ?? b.id),
		);
		const filter = el("input", "wt-input wt-filter") as HTMLInputElement;
		filter.placeholder = "Filter providers";
		filter.addEventListener("input", () => {
			const q = filter.value.trim().toLowerCase();
			for (const row of body.querySelectorAll<HTMLElement>(".wt-provider")) row.hidden = !row.dataset.name?.includes(q);
		});
		body.append(filter);
		for (const provider of providers) {
			const row = el("div", "wt-provider", `<b>${encode(provider.name ?? provider.id)}</b>${stored.has(provider.id) ? ` <span class="wt-ok">signed in</span>` : ""}`);
			const methods: { type: "api_key" | "oauth"; label: string }[] = [];
			if (provider.auth.apiKey) methods.push({ type: "api_key", label: "API key" });
			if (provider.auth.oauth) methods.push({ type: "oauth", label: provider.auth.oauth.loginLabel ?? provider.auth.oauth.name });
			row.dataset.name = `${provider.name ?? ""} ${provider.id}`.toLowerCase();
			for (const method of methods) {
				const blocked = BLOCKED[`${provider.id}:${method.type}`];
				const b = el("button", `wt-btn${blocked ? " blocked" : ""}`, `${encode(method.label)}${blocked ? `<small>${encode(blocked)}</small>` : ""}`);
				b.onclick = () => runLogin(provider.id, method.type, body, close);
				row.append(b);
			}
			if (stored.has(provider.id)) {
				const out = el("button", "wt-btn subtle", "Sign out");
				out.onclick = async () => {
					await credentials.delete(provider.id);
					close();
					await applyModel();
				};
				row.append(out);
			}
			body.append(row);
		}
	}

	async function runLogin(providerId: string, type: "api_key" | "oauth", body: HTMLElement, close: () => void) {
		body.innerHTML = "";
		const abort = new AbortController();
		const cancel = el("button", "wt-btn subtle", "Cancel");
		cancel.onclick = () => {
			abort.abort();
			close();
		};
		const back = el("button", "wt-btn subtle", "Back");
		back.onclick = () => {
			abort.abort();
			void renderProviders(body, close);
		};
		const steps = el("div");
		const actions = el("div", "wt-actions");
		actions.append(back, cancel);
		body.append(steps, actions);
		try {
			await models.login(
				providerId,
				type,
				{ signal: abort.signal, prompt: (p) => askPrompt(steps, p), notify: (e) => showEvent(steps, e) },
				{ getDeviceId: deviceId, agentName: "Walkthrough" },
			);
			close();
			chosen = null;
			await applyModel();
		} catch (error) {
			if (abort.signal.aborted) return;
			steps.querySelector(".wt-paste")?.remove();
			steps.append(el("div", "wt-error", `<p>${encode(error instanceof Error ? error.message : String(error))}</p>`));
		}
	}

	/* ---- rail */
	const rail = $("#wt-outline");
	function renderRail(progress: Progress | undefined) {
		rail.innerHTML = data.concepts
			.map((c, i) => {
				const status = progress?.concepts[c.id]?.status;
				const part = c.part && c.part !== data.concepts[i - 1]?.part ? `<li class="part">${encode(c.part)}</li>` : "";
				return `${part}<li class="${status ?? ""}"><span class="dot">${status === "done" ? "✓" : i + 1}</span>${encode(c.title)}</li>`;
			})
			.join("");
		const grades = progress?.grades ?? [];
		const done = data.concepts.filter((c) => progress?.concepts[c.id]?.status === "done").length;
		$("#wt-outline-btn").textContent = `Outline · ${done}/${data.concepts.length}`;
		$("#wt-score").textContent = grades.length
			? `${grades.filter((g) => g.verdict === "correct").length} of ${grades.length} answers correct`
			: "";
	}

	/* ---- transcript */
	const transcript = $("#wt-transcript");
	const live = $("#wt-live");
	const rendered = new Set<number>();

	function appendEntry(entry: Entry) {
		const message = entry.model?.[0] as Json | undefined;
		if (!message) return;
		if (entry.kind === "pi.user") {
			const content = message.content;
			const textContent = typeof content === "string" ? content : (content as { type: string; text?: string }[]).map((c) => c.text ?? "").join("");
			transcript.append(el("div", "wt-user", md(textContent)));
		} else if (entry.kind === "pi.assistant") {
			const blocks = (message.content as { type: string; text?: string; name?: string; arguments?: Json }[]) ?? [];
			for (const block of blocks) {
				if (block.type === "text" && block.text?.trim()) {
					const node = el("div", "wt-assistant", renderMarkdown(block.text, `a${entry.id}_`));
					transcript.append(node);
					activate(node);
					linkCitations(node);
				} else if (block.type === "toolCall" && block.name !== "render") {
					appendTool(toolLabel(block.name ?? "", block.arguments ?? {}));
				}
			}
			if (message.stopReason === "error" && message.errorMessage)
				transcript.append(el("div", "wt-error", `<p>${encode(String(message.errorMessage))}</p>`));
		} else if (entry.kind === "pi.tool-result" && message.toolName === "render" && !message.isError) {
			const markdown = (message.details as { markdown?: string } | undefined)?.markdown;
			if (markdown) {
				const node = el("div", "wt-card", renderMarkdown(markdown, `c${entry.id}_`));
				transcript.append(node);
				activate(node);
				linkCitations(node);
			}
		}
	}

	/** Consecutive tool calls collapse into one expandable line. */
	function appendTool(label: string) {
		let group = transcript.lastElementChild as HTMLDetailsElement | null;
		if (!group?.classList.contains("wt-tools")) {
			group = el("details", "wt-tools", "<summary></summary>") as HTMLDetailsElement;
			transcript.append(group);
		}
		group.append(el("div", "wt-tool", encode(label)));
		const items = group.querySelectorAll(".wt-tool");
		const first = items[0]?.textContent ?? label;
		(group.querySelector("summary") as HTMLElement).textContent = items.length === 1 ? first : `${first} and ${items.length - 1} more`;
	}

	function toolLabel(name: string, args: Json): string {
		if (name === "read") return `read ${args.path}${args.offset ? `:${args.offset}` : ""}`;
		if (name === "grep") return `grep ${args.pattern}${args.glob ? ` in ${args.glob}` : ""}`;
		if (name === "find") return `find ${args.pattern}`;
		if (name === "ls") return `ls ${args.path ?? "/"}`;
		if (name === "progress") return `${args.status === "done" ? "finished" : "started"} ${args.concept}`;
		if (name === "grade") return `graded: ${args.verdict}`;
		return name;
	}

	let busy = false;
	function renderLive(view: View) {
		const state = view.docs["pi.live"] as { run?: unknown; generation?: { message?: { content?: { type: string; text?: string }[] } }; tools?: { name: string }[] } | undefined;
		busy = Boolean(state?.run);
		const partial = state?.generation?.message?.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "";
		const tools = state?.tools?.map((t) => t.name).join(", ");
		live.innerHTML = partial ? md(partial) : busy ? `<p class="wt-working">${tools ? `working: ${encode(tools)}` : "thinking"}…</p>` : "";
		$("#wt-send").textContent = busy ? "Stop" : "Send";
		$("#wt-start-btn").hidden = view.entries.some((e) => e.kind === "pi.user");
	}

	const view = await root.viewState(ctx);
	const update = async (value: View) => {
		for (const entry of value.entries) {
			if (rendered.has(entry.id)) continue;
			rendered.add(entry.id);
			appendEntry(entry);
		}
		renderLive(value);
		renderRail(await harness.snapshot(ProgressDoc, root.id, ctx));
		if (follow) window.scrollTo({ top: document.body.scrollHeight });
	};
	// Follow new output only after the learner sent something, and only while they stay near the bottom.
	let follow = false;
	window.addEventListener("scroll", () => {
		if (sending) return;
		follow = window.innerHeight + window.scrollY > document.body.scrollHeight - 160;
	});
	let sending = false;
	view.subscribe((value) => void update(value as unknown as View));
	await update(view.value as unknown as View);
	// A resumed conversation opens where it left off.
	if ((view.value as unknown as View).entries.some((e) => e.kind === "pi.user")) {
		follow = true;
		requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight }));
	}

	/* ---- composer */
	const input = $<HTMLTextAreaElement>("#wt-input");
	async function send(textValue: string) {
		if (!chosen) return openLogin();
		if (!textValue.trim()) return;
		input.value = "";
		input.style.height = "auto";
		follow = true;
		sending = true;
		setTimeout(() => (sending = false), 800);
		try {
			await root.submit({ type: "input", content: textValue, whenBusy: "steer" }, ctx);
		} catch (error) {
			transcript.append(el("div", "wt-error", `<p>${encode(error instanceof Error ? error.message : String(error))}</p>`));
		}
	}
	$("#wt-send").onclick = () => (busy && !input.value.trim() ? void root.abort(ctx) : void send(input.value));
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			void send(input.value);
		}
	});
	const grow = () => {
		input.style.height = "auto";
		input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
	};
	input.addEventListener("input", grow);
	$("#wt-start-btn").onclick = () => void send("Let's start.");
	const parts: { name: string; concepts: string[] }[] = [];
	for (const c of data.concepts) {
		const name = c.part ?? "";
		if (parts.at(-1)?.name !== name) parts.push({ name, concepts: [] });
		parts.at(-1)?.concepts.push(c.title);
	}
	let n = 0;
	$("#wt-concepts").innerHTML = parts
		.map(
			(p) =>
				`<div class="wt-part">${p.name ? `<b>${encode(p.name)}</b>` : ""}<ol start="${n + 1}">${p.concepts.map((t) => (n++, `<li>${encode(t)}</li>`)).join("")}</ol></div>`,
		)
		.join("");

	await applyModel();
	if (!chosen) await openLogin();
	$("#wt-boot").remove();
}

/** Takes the Web Lock `name` and holds it for the page's lifetime; false when another tab holds it. */
function holdLock(name: string): Promise<boolean> {
	if (!navigator.locks) return Promise.resolve(true);
	return new Promise((resolve) => {
		void navigator.locks.request(name, { ifAvailable: true }, (lock) => {
			resolve(lock !== null);
			return lock ? new Promise<void>(() => {}) : undefined;
		});
	});
}

function deviceId(): string {
	let id = localStorage.getItem("walkthrough:device");
	if (!id) {
		id = crypto.randomUUID();
		localStorage.setItem("walkthrough:device", id);
	}
	return id;
}

main().catch((error) => {
	const boot = document.querySelector("#wt-boot");
	if (boot) boot.textContent = `Failed to start: ${error instanceof Error ? error.message : String(error)}`;
	console.error(error);
});
