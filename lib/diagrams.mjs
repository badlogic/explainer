// Text DSLs for diagrams, rendered as SVG in the book's style.
//   flow:     rows of boxes plus arrows between them (pipelines, topologies, state machines, layer stacks)
//   sequence: actors with lifelines and messages in time order (protocols, call paths)
// Both support `animate`: elements appear in order when the figure scrolls into view.

const W = 720;
const M = 16;
const INK = "#2a2723";
const MUTED = "#7b7468";
const RULE = "#c9bfae";
const COLORS = { accent: "#b4472f", blue: "#2e6a8a", muted: MUTED, ink: INK };
const SANS = 6.1; // average px per char at 11px sans
const MONO = 6.7; // px per char at 11px Menlo

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Split a DSL line into tokens; quoted strings keep spaces. */
function tokens(line) {
	const out = [];
	for (const m of line.matchAll(/"((?:\\.|[^"\\])*)"|(\S+)/g))
		out.push(m[1] !== undefined ? { q: true, v: m[1].replace(/\\"/g, '"') } : { q: false, v: m[2] });
	return out;
}

/** `code` text renders monospace; returns { text, mono }. */
function textSpec(raw) {
	const m = /^`(.*)`$/.exec(raw ?? "");
	return m ? { text: m[1], mono: true } : { text: raw ?? "", mono: false };
}

function wrap(text, maxPx, size, mono) {
	const per = ((mono ? MONO : SANS) * size) / 11;
	const max = Math.max(4, Math.floor(maxPx / per));
	const words = text.split(/\s+/).filter(Boolean);
	const lines = [];
	let cur = "";
	for (const w of words) {
		if (!cur) cur = w;
		else if ((cur + " " + w).length <= max) cur += ` ${w}`;
		else {
			lines.push(cur);
			cur = w;
		}
	}
	if (cur) lines.push(cur);
	return lines.length ? lines : [""];
}

function textEl(x, y, spec, { size = 11, fill = INK, anchor = "middle", weight, spacing, upper } = {}) {
	const t = upper ? spec.text.toUpperCase() : spec.text;
	return `<text x="${r(x)}" y="${r(y)}" font-size="${size}" fill="${fill}" text-anchor="${anchor}"${spec.mono ? ' font-family="Menlo,monospace"' : ""}${weight ? ` font-weight="${weight}"` : ""}${spacing ? ` letter-spacing="${spacing}"` : ""}>${esc(t)}</text>`;
}

const r = (n) => Math.round(n * 10) / 10;

function markers(id) {
	return `<defs>${Object.entries({ m: MUTED, a: COLORS.accent, b: COLORS.blue })
		.map(
			([k, c]) =>
				`<marker id="${id}${k}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${c}"/></marker>`,
		)
		.join("")}</defs>`;
}

function svgOpen(height, label) {
	return `<svg viewBox="0 0 ${W} ${r(height)}" width="100%" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg" style="font-family:'Avenir Next','Helvetica Neue',Helvetica,Arial,sans-serif;max-width:760px">`;
}

function boxStyle(flags) {
	const fill = flags.has("muted") ? "#efe9dd" : flags.has("soft") ? "#f4eee2" : "#fff";
	const stroke = flags.has("accent") ? COLORS.accent : flags.has("blue") ? COLORS.blue : RULE;
	const width = flags.has("accent") || flags.has("blue") ? ' stroke-width="1.5"' : "";
	const dash = flags.has("dashed") ? ' stroke-dasharray="3 3"' : "";
	return `fill="${fill}" stroke="${stroke}"${width}${dash}`;
}

function notesBlock(notes, y) {
	let out = "";
	for (const n of notes)
		for (const line of wrap(n, W - 2 * M, 10.5, false)) {
			out += textEl(M, y, { text: line, mono: false }, { size: 10.5, fill: MUTED, anchor: "start" });
			y += 15;
		}
	return { out, y };
}

function step(i, cls, inner) {
	return i === undefined ? inner : `<g class="${cls}" style="--i:${i}">${inner}</g>`;
}

/* ------------------------------------------------------------------ flow */

export function flow(source, { id, label, animate }) {
	const rows = [];
	const arrows = [];
	const notes = [];
	const boxes = new Map();
	for (const raw of source.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const t = tokens(line);
		const cmd = t[0].v;
		const flags = new Set(t.filter((x) => !x.q).map((x) => x.v));
		const quoted = t.filter((x) => x.q).map((x) => x.v);
		if (cmd === "row") {
			const color = ["accent", "blue", "muted"].find((c) => flags.has(c)) ?? "muted";
			rows.push({ label: quoted[0], color, slots: [] });
		} else if (cmd === "box" || cmd === "gap") {
			if (!rows.length) rows.push({ slots: [] });
			if (cmd === "gap") rows.at(-1).slots.push(null);
			else {
				const box = { id: t[1].v, title: textSpec(quoted[0] ?? t[1].v), detail: textSpec(quoted[1]), flags };
				if (boxes.has(box.id)) throw new Error(`flow: duplicate box ${box.id}`);
				boxes.set(box.id, box);
				rows.at(-1).slots.push(box);
			}
		} else if (cmd === "arrow") {
			const [from, op, to] = [t[1]?.v, t[2]?.v, t[3]?.v];
			if (!["->", "<-", "<->"].includes(op)) throw new Error(`flow: expected "arrow A -> B": ${line}`);
			for (const b of [from, to]) if (!boxes.has(b)) throw new Error(`flow: unknown box ${b} in: ${line}`);
			arrows.push({
				from: op === "<-" ? to : from,
				to: op === "<-" ? from : to,
				both: op === "<->",
				label: textSpec(quoted[0]),
				flags,
			});
		} else if (cmd === "note") notes.push(quoted[0] ?? "");
		else throw new Error(`flow: unknown command "${cmd}" in: ${line}`);
	}

	// Layout rows.
	let y = 12;
	const GAP = 26;
	for (const row of rows) {
		if (row.label) {
			row.labelY = y + 10;
			y += 24;
		}
		const n = row.slots.length;
		const w = Math.min(210, (W - 2 * M - GAP * (n - 1)) / n);
		const total = n * w + (n - 1) * GAP;
		let x = (W - total) / 2;
		let h = 44;
		for (const box of row.slots) {
			if (box) {
				box.titleLines = wrap(box.title.text, w - 14, 11, box.title.mono);
				box.detailLines = box.detail.text ? wrap(box.detail.text, w - 14, 9.5, box.detail.mono) : [];
				box.x = x;
				box.w = w;
				h = Math.max(h, 16 + box.titleLines.length * 14 + box.detailLines.length * 12.5);
			}
			x += w + GAP;
		}
		for (const box of row.slots) if (box) Object.assign(box, { y, h, row });
		row.y = y;
		row.h = h;
		y += h + 54;
	}
	y -= 54 - 18;

	// Animation order: arrows in listed order reveal their endpoints.
	if (animate) {
		let k = 1;
		const referenced = new Set(arrows.flatMap((a) => [a.from, a.to]));
		for (const b of boxes.values()) if (!referenced.has(b.id)) b.i = 0;
		for (const a of arrows) {
			const src = boxes.get(a.from);
			const dst = boxes.get(a.to);
			if (src.i === undefined) src.i = k++;
			a.i = k++;
			if (dst.i === undefined) dst.i = k++;
		}
	}

	let body = "";
	for (const row of rows)
		if (row.label)
			body += textEl(M, row.labelY, { text: row.label }, { size: 10, fill: COLORS[row.color], anchor: "start", weight: 600, spacing: 2, upper: true });

	for (const b of boxes.values()) {
		const cx = b.x + b.w / 2;
		const contentH = b.titleLines.length * 14 + b.detailLines.length * 12.5;
		let ty = b.y + (b.h - contentH) / 2 + 10.5;
		let inner = `<rect x="${r(b.x)}" y="${r(b.y)}" width="${r(b.w)}" height="${r(b.h)}" rx="4" ${boxStyle(b.flags)}/>`;
		for (const line of b.titleLines) {
			inner += textEl(cx, ty, { text: line, mono: b.title.mono }, { size: 11 });
			ty += 14;
		}
		for (const line of b.detailLines) {
			inner += textEl(cx, ty, { text: line, mono: b.detail.mono }, { size: 9.5, fill: MUTED });
			ty += 12.5;
		}
		body += step(b.i, "step", inner);
	}

	const pairs = new Set(arrows.map((a) => `${a.from}>${a.to}`));
	for (const a of arrows) {
		const A = boxes.get(a.from);
		const B = boxes.get(a.to);
		const color = a.flags.has("accent") ? "a" : a.flags.has("blue") ? "b" : "m";
		const stroke = color === "a" ? COLORS.accent : color === "b" ? COLORS.blue : MUTED;
		const dash = a.flags.has("dashed") ? ' stroke-dasharray="4 3"' : "";
		const markEnd = ` marker-end="url(#${id}${color})"`;
		const markStart = a.both ? ` marker-start="url(#${id}${color})"` : "";
		const twin = pairs.has(`${a.to}>${a.from}`) && !a.both;
		let d;
		let lx;
		let ly;
		let anchor = "middle";
		if (A.row === B.row) {
			const off = twin ? (A.x < B.x ? -7 : 7) : 0;
			const cy = A.y + A.h / 2 + off;
			const between = A.row.slots.some((s) => s && s !== A && s !== B && s.x > Math.min(A.x, B.x) && s.x < Math.max(A.x, B.x));
			if (between) {
				const x1 = A.x + A.w / 2;
				const x2 = B.x + B.w / 2;
				const top = A.y - 4;
				d = `M${r(x1)} ${r(top)} Q${r((x1 + x2) / 2)} ${r(top - 44)} ${r(x2)} ${r(top)}`;
				lx = (x1 + x2) / 2;
				ly = top - 26;
			} else {
				const [x1, x2] = A.x < B.x ? [A.x + A.w, B.x] : [A.x, B.x + B.w];
				d = `M${r(x1)} ${r(cy)} L${r(x2 + (A.x < B.x ? -2 : 2))} ${r(cy)}`;
				lx = (x1 + x2) / 2;
				ly = cy - 7;
			}
		} else {
			const down = B.y > A.y;
			const off = twin ? (down ? -9 : 9) : 0;
			const x1 = A.x + A.w / 2 + off;
			const x2 = B.x + B.w / 2 + off;
			const y1 = down ? A.y + A.h : A.y;
			const y2 = down ? B.y - 2 : B.y + B.h + 2;
			d = `M${r(x1)} ${r(y1)} L${r(x2)} ${r(y2)}`;
			lx = (x1 + x2) / 2 + 8;
			ly = (y1 + y2) / 2 + 4;
			anchor = "start";
			if (Math.abs(x1 - x2) < 1 && twin && off < 0) {
				anchor = "end";
				lx = (x1 + x2) / 2 - 8;
			}
		}
		let inner = `<path d="${d}" fill="none" stroke="${stroke}"${dash}${markEnd}${markStart}/>`;
		if (a.label.text) {
			const per = ((a.label.mono ? MONO : SANS) * 9.5) / 11;
			const tw = a.label.text.length * per + 8;
			const bx = anchor === "middle" ? lx - tw / 2 : anchor === "start" ? lx - 4 : lx - tw + 4;
			inner += `<rect x="${r(bx)}" y="${r(ly - 10)}" width="${r(tw)}" height="13" fill="#fbf8f2" opacity=".92"/>`;
			inner += textEl(lx, ly, a.label, { size: 9.5, fill: color === "m" ? MUTED : stroke, anchor });
		}
		body += step(a.i, "step edge", inner);
	}

	const n = notesBlock(notes, y + 6);
	const total = notes.length ? n.y : y;
	return svgOpen(total, label) + markers(id) + body + n.out + "</svg>";
}

/* -------------------------------------------------------------- sequence */

export function sequence(source, { id, label, animate }) {
	const actors = [];
	const byId = new Map();
	const items = [];
	for (const raw of source.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		let m;
		if (line.startsWith("actor ")) {
			const t = tokens(line);
			const quoted = t.filter((x) => x.q).map((x) => x.v);
			const a = {
				id: t[1].v,
				title: textSpec(quoted[0] ?? t[1].v),
				detail: textSpec(quoted[1]),
				flags: new Set(t.filter((x) => !x.q).map((x) => x.v)),
			};
			actors.push(a);
			byId.set(a.id, a);
		} else if ((m = /^(\S+)\s*(-->|->|=>)\s*(\S+)\s*:\s*(.*)$/.exec(line))) {
			for (const x of [m[1], m[3]]) if (!byId.has(x)) throw new Error(`sequence: unknown actor ${x}`);
			items.push({ kind: "msg", from: m[1], op: m[2], to: m[3], label: textSpec(m[4]) });
		} else if ((m = /^note\s+(\S+?)(?:\.\.(\S+))?\s*:\s*(.*)$/.exec(line))) {
			items.push({ kind: "note", from: m[1], to: m[2] ?? m[1], label: textSpec(m[3]) });
		} else if ((m = /^divider\s*(.*)$/.exec(line))) {
			items.push({ kind: "divider", label: textSpec(m[1].replace(/^"|"$/g, "")) });
		} else throw new Error(`sequence: cannot parse: ${line}`);
	}
	const n = actors.length;
	const colW = (W - 2 * M) / n;
	actors.forEach((a, i) => {
		a.cx = M + colW * (i + 0.5);
	});
	const headH = actors.some((a) => a.detail.text) ? 42 : 32;
	const top = 10;
	let y = top + headH + 26;
	let body = "";
	let k = 1;
	for (const it of items) {
		const i = animate ? k++ : undefined;
		if (it.kind === "msg") {
			const A = byId.get(it.from);
			const B = byId.get(it.to);
			const color = it.op === "=>" ? "a" : "m";
			const stroke = color === "a" ? COLORS.accent : MUTED;
			const dash = it.op === "-->" ? ' stroke-dasharray="4 3"' : "";
			let inner;
			if (A === B) {
				// Loop and label go right, unless the label would run past the edge (the last actor): then left.
				const tw = it.label.text.length * (it.label.mono ? MONO : SANS) * (10 / 11);
				const left = A.cx + 42 + tw > W - 4 && A.cx - 42 - tw >= 4;
				const s = left ? -1 : 1;
				inner = `<path d="M${r(A.cx)} ${r(y - 6)} h${34 * s} v14 h${-32 * s}" fill="none" stroke="${stroke}"${dash} marker-end="url(#${id}${color})"/>`;
				inner += textEl(A.cx + 42 * s, y + 4, it.label, { size: 10, fill: color === "a" ? stroke : INK, anchor: left ? "end" : "start" });
				y += 40;
			} else {
				const dir = B.cx > A.cx ? 1 : -1;
				inner = `<line x1="${r(A.cx)}" y1="${r(y)}" x2="${r(B.cx - dir * 3)}" y2="${r(y)}" stroke="${stroke}"${dash} marker-end="url(#${id}${color})"/>`;
				inner += textEl((A.cx + B.cx) / 2, y - 6, it.label, { size: 10, fill: color === "a" ? stroke : INK });
				y += 32;
			}
			body += step(i, "step edge", inner);
		} else if (it.kind === "note") {
			const A = byId.get(it.from);
			const B = byId.get(it.to);
			const x1 = Math.min(A.cx, B.cx) - colW / 2 + 10;
			const x2 = Math.max(A.cx, B.cx) + colW / 2 - 10;
			const lines = wrap(it.label.text, x2 - x1 - 14, 10, it.label.mono);
			const h = 10 + lines.length * 13;
			let inner = `<rect x="${r(x1)}" y="${r(y - 14)}" width="${r(x2 - x1)}" height="${r(h)}" rx="3" fill="#f4eee2" stroke="#c2b18c"/>`;
			lines.forEach((l, j) => {
				inner += textEl((x1 + x2) / 2, y + j * 13, { text: l, mono: it.label.mono }, { size: 10, fill: "#5b5549" });
			});
			body += step(i, "step", inner);
			y += h + 14;
		} else {
			let inner = `<line x1="${M}" y1="${r(y - 4)}" x2="${W - M}" y2="${r(y - 4)}" stroke="${RULE}" stroke-dasharray="2 4"/>`;
			if (it.label.text) {
				const tw = it.label.text.length * 6 + 16;
				inner += `<rect x="${r(W / 2 - tw / 2)}" y="${r(y - 14)}" width="${r(tw)}" height="18" fill="#fbf8f2"/>`;
				inner += textEl(W / 2, y, it.label, { size: 9.5, fill: MUTED, upper: true, spacing: 1.5, weight: 600 });
			}
			body += step(i, "step", inner);
			y += 30;
		}
	}
	const bottom = y - 8;
	let head = "";
	for (const a of actors) {
		const w = Math.min(colW - 14, 170);
		head += `<line x1="${r(a.cx)}" y1="${top + headH}" x2="${r(a.cx)}" y2="${r(bottom)}" stroke="${RULE}" stroke-dasharray="3 3"/>`;
		head += `<rect x="${r(a.cx - w / 2)}" y="${top}" width="${r(w)}" height="${headH}" rx="4" ${boxStyle(a.flags)}/>`;
		head += textEl(a.cx, top + (a.detail.text ? 17 : 20), a.title, { size: 11 });
		if (a.detail.text) head += textEl(a.cx, top + 31, a.detail, { size: 9.5, fill: MUTED });
	}
	return svgOpen(bottom + 8, label) + markers(id) + head + body + "</svg>";
}
