# explainer

A [pi](https://github.com/earendil-works/pi) skill that turns Markdown into two kinds of single-file HTML pages:

- **Books**: long-form explainers (design docs, API guides, investigations) with a fixed book layout, typography,
  animated sequence and flow diagrams, steppers and notes.
- **Walkthroughs**: an interactive tutor in one HTML page. An agent (pi-durable and pi-ai, running in the browser)
  teaches a topic one concept at a time from bundled sources, draws figures on the fly, asks check questions and
  tracks progress. The reader signs in with an API key (or OAuth where the provider allows it) and chats.

100% slop: written by an agent, lightly supervised. Use at your own risk.

## Install

```sh
git clone https://github.com/badlogic/explainer ~/.pi/agent/skills/explainer
cd ~/.pi/agent/skills/explainer && npm install --ignore-scripts
```

pi picks the skill up from `~/.pi/agent/skills`. Ask it for an explainer, guide or walkthrough, or follow
[`SKILL.md`](SKILL.md) yourself.

## Use

```sh
node build.mjs book.md -o index.html                 # a book
cd <repo> && node <skill>/build.mjs walkthrough.md -o walkthrough.html   # a walkthrough (front matter kind: walkthrough)
```

[`SKILL.md`](SKILL.md) documents the format; [`template.md`](template.md) shows every book feature.
[`examples/durable/`](examples/durable) has a sample book and a sample walkthrough (with their built HTML) on how
pi-durable survives a crash: the reference for prose style and structure.

## Layout

- `build.mjs`: the CLI.
- `lib/render.mjs`: Markdown, directives and the page runtime (shared by books and walkthrough cards).
- `lib/diagrams.mjs`, `lib/highlight.mjs`: the flow and sequence DSLs, code highlighting.
- `lib/walkthrough.mjs`: builds walkthrough pages (outline, check questions, bundled sources).
- `book.css`: the design.
- `walkthrough/`: the browser runtime of walkthroughs. `dist/runtime.js` is prebuilt and committed, so building a
  walkthrough needs no bundler. Rebuild it with `cd walkthrough && npm install --ignore-scripts && npm run check &&
  npm run build`.

## License

MIT
