---
title: Coming Back
kind: walkthrough
kicker: A sample walkthrough · pi-durable 1.3.0
subtitle: How a pi-durable agent survives a crash, taught one concept at a time
model: anthropic/claude-sonnet-5-5
sources:
  - book.md
  - pi-durable-README.md
truth: pi-durable-README.md wins over book.md (the book is a sample explainer written from it)
---

:::tutor
Audience: a TypeScript developer who has used an LLM API but not pi-durable. Use the book's scenario (Lena closes the
laptop lid mid-turn, while `bash` runs the tests) as the running example. Read the matching book chapter before each
concept, and check details in the README. Short messages; one figure per concept at most.
:::

# One line of commits {#commits}
Book chapter I; README "Concepts". Must cover: entries, documents and tasks change only in atomic commits on one line
per Harness; nothing is shown or runs before its commit is stored; after a crash the store is in a state between two
commits. A sequence figure of one answered input helps.

:::check
1. The process dies while a commit that appends a tool result and edits a document is being written. What is in the store afterwards?
+++ answers
1. Either both or neither: a commit is atomic, so the store holds the state before that commit.
:::

# Tasks that remember {#tasks}
Book chapter II; README "Concepts", "Persist and Resume", "Task Graph". Must cover: pi.generation owns pi.tool tasks
and waits for them; checkpoints per step; reopen plus resume(); running tasks show as pending after a restart.

:::check
1. After the restart, what does the app have to call so the unfinished run continues, and is there another way it starts?
+++ answers
1. harness.resume(); submitting or waiting also starts the task scheduler.
:::

# Tools after a crash {#tools}
Book chapter III; README "Tools", "Calling tools from tools". Must cover: intent committed before execute(); replay:
"safe" reruns; otherwise an interrupted error result with the output so far; the 100 ms progress window; nested calls.

:::check
1. A tool sends an email. Should it be declared replay: "safe"? What would it need?
2. How much of bash's streamed output can a crash lose with the default settings?
+++ answers
1. Only if the email call is idempotent, for example with a request id derived from the task id; "safe" is the author's promise and the Harness cannot check it. Otherwise leave it unsafe so the model gets an interrupted result.
2. At most the last progress window, 100 ms by default (settings.progress).
:::

# Asking twice {#requests}
Book chapter IV; README "Persist and Resume". Must cover: requestId dedupe of submissions, harness.submission(id),
minting the id when the user presses Send and reusing it on retries.

:::check
1. The app retries a submit after a restart with a new random requestId. What goes wrong?
+++ answers
1. The Harness cannot match it to the first submission, so if the first one was admitted the input is answered twice.
:::

# Limits {#limits}
Book epilogue; README "Errors", "Storage". Must cover: a storage error ends the Harness and the host reopens; one
process per storage; SQLite WAL with synchronous NORMAL may lose the newest commit on power loss.

:::check
1. Two browser tabs open the same storage. What protects the data?
+++ answers
1. Nothing in pi-durable: there is no cross-process locking; the host must ensure one owner, for example with a Web Lock.
:::
