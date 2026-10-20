---
name: explainer
description: Write explainers (design docs, API guides, system walkthroughs, investigations, call summaries, "how does X work" write-ups) as a book-style HTML page built from Markdown, with a fixed layout, typography, prose style, diagrams and animations; or an interactive walkthrough, a single HTML page in which an embedded agent tutors the reader one concept at a time. Use whenever the user asks for an explainer, design book, guide, long-form explanation document, walkthrough or tutorial.
---

# Explainer

Every explainer is a small book: cover, contents, preface, numbered chapters, open questions, appendices, colophon. Write it as **Markdown** (`book.md`); `build.mjs` turns it into one self-contained HTML file with the fixed design. Write less, get the full layout.

Files in this skill directory (resolve paths against it):

- `build.mjs`: `node <skill>/build.mjs book.md [-o index.html]`. Default output: `book.html` next to the input.
- `examples/durable/`: samples of the expected prose style, structure and figures, written from pi-durable's public
  README (`pi-durable-README.md`): `book.md` (built: `index.html`) and `walkthrough.md` (built: `walkthrough.html`).
  Read `book.md` before writing a book and `walkthrough.md` before writing a walkthrough.
- `template.md`: a complete example using every feature (syntax reference).
- `book.css`: the design. Do not edit per book.
- `lib/diagrams.mjs`, `lib/highlight.mjs`: diagram DSLs and code highlighting (used by the build).
- `walkthrough/`: the prebuilt runtime of walkthrough pages (`dist/runtime.js`) and its sources. See "Walkthroughs" below.

Dependencies: `marked` (pinned in `package.json`). If `node_modules` is missing: `cd <skill> && npm install --ignore-scripts`.

## Rules

- Write Markdown; never hand-write the book HTML or CSS. Use `:::raw` only for genuinely interactive or bespoke parts.
- Output one HTML file. Static content needs no JavaScript; the build inlines a tiny runtime only when animations or steppers are used. External libraries only via front matter `scripts:`/`head:` and only when an interactive element needs them.
- No emojis, no exclamation marks, no marketing tone.
- Write the book where the user asks; otherwise next to the subject (e.g. `docs/<topic>/explainer/book.md` and `index.html`). Keep the `.md` next to the `.html` so it can be rebuilt.

## Format

### Front matter

```
---
title: Chord: building apps with live reload      # <title> and default cover text
cover: Chord / Guide                               # cover heading lines, split on " / "
kicker: A guide · Chord v2 · 2026-10-20            # small caps line above the title
subtitle: One italic sentence, concrete, from the reader's point of view
stats:                                             # 3-4 real numbers from the material; "value | label"
  - 6–7k | target lines of code
note: |                                            # cover note (Markdown): provenance, state, how to read review notes
  Based on ...
colophon: Title · edition · date · sources
scripts:                                           # optional: <script src> in <head>, for interactive parts only
  - https://cdn.jsdelivr.net/npm/some-lib@1.2.3/dist/lib.min.js
head: |                                            # optional: raw HTML appended to <head>
  <script type="module">import x from "https://esm.sh/x@1";</script>
---
```

### Sections

Each `# ` heading starts a section, in order. Attributes in braces:

- `# Before we begin {.preface}`: no numeral, plain heading. Use once, first.
- `# Writing It Down {#outbox lede="One italic sentence: what this chapter answers."}`: a chapter, auto-numbered I, II, III. Id defaults to a slug of the title.
- `# Open Questions {.epilogue lede="..."}`: numeral ∴.
- `# Reference {.appendix}`: numerals A, B, ...
- `{.nodrop}` suppresses the drop cap. The first paragraph of every other non-appendix section gets one automatically.

`##` is a subsection (small-caps sans), `###` a minor heading. The table of contents is generated.

### Markdown

GFM: paragraphs, lists, tables, `inline code`, **bold** for defined terms, *italic* for quoted spec wording. Fenced code: `ts`, `js`, `tsx`, `json`, `sh` are syntax highlighted; any other language tag (`text`, `trace`) renders plain. Raw inline HTML is allowed.

### Directives

`:::name flags key=value | Title or caption` ... `:::`. Directives nest (e.g. a `flow` inside a `steps` panel).

- `:::findings` around an ordered list: the "N things to know" list. Each item starts with `**Short claim.**`.
- `:::note | Tag` and `:::review | Review: short title`: asides. A review note is an unsettled point or a mismatch found while checking sources (name the file, the claim, the correct claim).
- `:::stats`: lines `value | label`, a ruled row of numbers inside a chapter.
- `:::figure wide | Caption`: body is raw HTML/SVG (or Markdown). Use for bespoke figures.
- `:::flow wide animate pace=0.5 | Caption`: a box-and-arrow diagram from a DSL (below).
- `:::sequence animate | Caption`: a sequence diagram from a DSL (below).
- `:::steps | Title`: a stepper. Panels start with `+++ Step title`; each panel is Markdown and may contain directives. With JS: one panel at a time with Back/Next, animated figures replay on show. Without JS: all panels stacked.
- `:::raw`: verbatim HTML, including `<script>`. The escape hatch for interactive demos, custom widgets, library-driven visualizations. Scope ids and globals to avoid collisions; match the palette and fonts below.

Figures (`figure`, `flow`, `sequence`) are numbered automatically; captions say what is shown, then the point it makes. `wide` bleeds into the margins. `animate` reveals elements in order when the figure scrolls into view and adds a Replay button; use it for paths, protocols and lifecycles where order is the point, not for static structure.

### Flow DSL

```
row "Section label" accent|blue|muted        # starts a row; label optional (uppercase, colored)
box id "Title" "detail" [accent|blue|muted|soft|dashed]
gap                                          # empty slot in the row, for alignment
arrow a -> b "label" [dashed|accent|blue]    # also a <- b, a <-> b
note "Footnote line under the diagram."
```

Rows are laid out top to bottom, boxes evenly across the row (max 210 px wide; text wraps). Text in backticks (`"`commit(writes)`"`) renders monospace. Arrows within a row are horizontal (curved over boxes in between); between rows they run bottom-to-top-center. Two arrows between the same pair in opposite directions are offset automatically. With `animate`, arrows appear in listed order and reveal their endpoints, so list arrows in the order of the story. Lay out rows so arrows are short: put a box under the box it comes from.

Use `accent` (rust) for what is new, important or the focus; `blue` for the contrasting role; `muted` for passive or external parts; `dashed` for planned, optional or hypothetical parts.

### Sequence DSL

```
actor tab "browser tab" "principal: guest" [blue|accent|muted]
actor server "server"
tab -> server: call Notes.add          # solid
server --> tab: result                 # dashed: reply
server => worker: hold (stamped)       # accent: the step that matters
server -> server: map ids              # self message (drawn to the left when the label would overflow)
note tab..server: spans these actors   # or: note server: one actor
divider "after a reconnect"
```

## Structure, in order

1. **Front matter** with cover: kicker, 1–3 word title, concrete subtitle, 3–4 real stats, a provenance note.
2. **Preface** (`{.preface}`, "Before we begin"): a concrete scenario (a person, a machine, a moment), the problem, why the obvious approach falls short; then `## N things to know` with `:::findings` (5–10 items: someone who reads only this list gets it); then `## Words used throughout`, one paragraph defining every recurring term in bold, in the order a reader meets them.
3. **Chapters** (4–20): short plain-spoken titles ("Writing It Down", "Coming Back", "Who Drives"), never "Architecture Overview"; a one-sentence lede; a first paragraph that sets up the chapter; `##` subsections.
4. **Epilogue** (`{.epilogue}`, "Open Questions" or "What's Next"): recap, then decisions needed / to verify.
5. **Appendices** (`{.appendix}`): reference tables, API surface, glossary (alphabetical), transcripts.
6. **Colophon** in front matter.

Drop sections without material, keep the order.

## Guides (teaching an API)

When the book teaches users to build with an API rather than explaining a design:

- Build one running example through the whole book (a small app that grows chapter by chapter). Every chapter adds one concept to it, with complete, runnable-looking code, not fragments without context.
- Order chapters by what a builder needs next, not by the spec's section order.
- For each concept: the problem it solves (a concrete failure without it), the smallest code that uses it, what happens at runtime (a `sequence` or `flow`, animated when order matters), the rules and footguns, then how it fits the running example.
- Use `:::steps` to walk through runtime behaviour (a call across hosts, a reload, a crash and recovery) one step at a time.
- Mark what is designed but not built, and what is undecided, with `:::review` or `:::note`, so readers do not build on sand.
- End with a reference appendix: API surface, defaults, error codes, versions, glossary.

## Voice and prose

- Explain, do not list. Each chapter is an argument in paragraphs. Bullets only for parallel items; tables for comparisons.
- Pattern for every non-trivial point: problem, concrete example or short trace, solution, and why it is necessary (versus optional complexity).
- Start concrete, then generalize. Plain, short, declarative sentences. Define a term before using it; one term per concept.
- Be exact: real identifiers, file paths, numbers. Say when a number is an estimate.
- Attribute decisions to people when the source is a conversation. Say what is decided, what is not, and what was found in review; never smooth over a disagreement between docs and code.
- No filler, no hype, no "simply", "just", "powerful", "seamless". No conclusions that repeat the chapter.

## Process

1. Gather: read the relevant sources in full (code, specs, docs, transcripts). Verify claims against code; record mismatches as review notes.
2. Outline: title, stats, the findings list, chapter titles with ledes. The findings list and chapter order should tell the story on their own.
3. Write `book.md` (for long books, write it in several files and concatenate, or write chapter by chapter with `edit`).
4. Build: `node <skill>/build.mjs book.md -o index.html`. Fix any build error (it names the directive or line).
5. Check visually if browser tools are available: open the HTML, look at the cover and every figure for overlapping or clipped text, and click through steppers. Fix layouts in the DSL (fewer boxes per row, shorter labels, reorder rows).
6. Publish or share only if the user asks.

## Walkthroughs

A walkthrough is the interactive sibling of a book: one HTML page in which an agent (pi-durable and pi-ai, running in
the browser) teaches a topic one concept at a time. It explains with figures it writes on the fly in the same
Markdown and directives as books, asks check questions, waits for answers, grades them and tracks progress. The
reader opens the page, signs in to a model provider (API key, or OAuth where the provider allows browser requests;
credentials stay in that browser) and chats.

Write `walkthrough.md` and build it like a book; front matter `kind: walkthrough` selects the walkthrough output:

```markdown
---
title: Chord v2
kind: walkthrough
subtitle: One sentence on what the reader will learn
model: anthropic/claude-sonnet-5-5          # default model; the reader can change it
sources:                                    # globs or paths, relative to the directory you run the build in
  - docs/design.md
  - src/contracts/*.ts
truth: design.md wins over the guide; code wins over its README
---

:::tutor
Audience, tone and what to lean on: "knows pi-durable, not Chord; use the guide's running example; say what is built".
:::

# Object types and objects {#objects}
Notes for the tutor (not shown to the reader): what this concept must cover, which source section to read first,
which figure would help.

:::check
1. Two tabs ask for the notes of S1. How often does the factory run?
+++ answers
1. Once: same address, same object.
:::
```

- Each `# ` heading is one concept, in teaching order. Its text is guidance for the tutor. `:::check` holds numbered
  questions and, after `+++ answers`, the expected answers (the tutor sees them, the reader does not).
- `sources` are bundled into the page as a read-only file system; the tutor reads them with `read`, `ls`, `find` and
  `grep` and cites `path:line`. The build refuses secret-looking files (`.env`, keys, `auth.json`) and prints the
  bundle size. Include the explainer book on the topic if there is one: it gives the tutor a running example.
- Build from the directory the source globs are relative to: `cd <repo> && node <skill>/build.mjs path/walkthrough.md
  -o path/walkthrough.html`. Keep the `.md` next to the `.html`.
- The tutor's built-in rules (one concept at a time, ask and wait, grade, cite sources, figure limits) are in
  `walkthrough/src/prompt.ts`; `:::tutor` adds the author's instructions on top.
- The page works from any static host. Model requests go from the reader's browser to the provider. Working: Radius
  (sign in with the browser, then paste the `localhost` address the sign-in tab ends on), Anthropic, OpenAI and
  OpenRouter API keys, OpenRouter OAuth. Blocked by the providers (no CORS headers for web pages): Claude Pro/Max,
  Sign in with ChatGPT, Codex, GitHub Copilot and xAI sign-ins. The sign-in dialog lists every pi-ai provider and
  labels the blocked ones.
- The conversation and progress live in memory for one visit (a reload starts over); credentials and the chosen
  model persist. Persistence comes with pi-durable's IndexedDB storage once it is published.
- Check it before publishing: open it in a browser (any local static server), sign in, press Start, answer one
  question, and look at the figures the tutor drew.

Rebuilding the runtime (only when changing `walkthrough/src/` or updating pi packages): `cd <skill>/walkthrough && npm
install --ignore-scripts && npm run check && npm run build`. Dependencies come from npm (`@earendil-works/pi-ai`,
`pi-durable`, `chord`), pinned in `walkthrough/package.json`.

