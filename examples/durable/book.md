---
title: Coming Back: how a pi-durable agent survives a crash
cover: Coming / Back
kicker: A sample explainer · pi-durable 1.3.0 · 2026-10-21
subtitle: What is stored when, what runs again after a restart, and what the model is told about work that was cut short
stats:
  - 1 | line of atomic commits per Harness
  - 100 ms | most streamed output a crash loses, by default
  - 4 | storage backends with the same rules
  - 0 | cross-process locks
note: |
  A sample book for the explainer skill, written from the published README of `@earendil-works/pi-durable` 1.3.0
  (`pi-durable-README.md` next to this file). It shows the expected structure, prose style and figures; it is not
  official documentation. Names and numbers are the README's.
colophon: Coming Back · sample edition · 2026-10-21 · based on the pi-durable 1.3.0 README
---

# Before we begin {.preface}

Lena runs a coding agent on her laptop. It is in the middle of a turn: the model asked for two tool calls, `read` has
finished, and `bash` is running the test suite. Lena closes the lid. The laptop sleeps, the battery runs out, and the
process is gone.

When she opens the laptop again and restarts the agent, she expects three things. The conversation is all there,
including the answer the model was streaming. The test run is not silently lost: either it runs again or the model
learns that it was cut short. And the message she sent just before closing the lid is not sent twice.

The obvious design does not give her that. An agent that keeps its state in memory and saves a transcript file now
and then loses everything since the last save. Saving after every step is not enough either: if the process dies
between "the tool ran" and "the result was saved", nobody knows whether the tool ran. pi-durable answers both with one
rule: **nothing is shown, and nothing runs, before the commit that records it is stored.** This book follows Lena's
turn through that rule.

## Six things to know

:::findings
1. **Everything is a commit.** Entries, documents and tasks change only in atomic commits on one line per Harness. A
   commit is stored before anything sees it.
2. **Work is tasks.** The model call and every tool call are durable tasks that save a checkpoint at every step, so a
   restarted process continues from the last one.
3. **Intent comes first.** A tool call's intent is committed before `execute()` runs. After a crash, the Harness knows
   which calls started and which finished.
4. **Tools decide whether they may run twice.** A tool declared `replay: "safe"` reruns after a crash; any other tool
   gives the model an `interrupted` error result with the output committed so far.
5. **Streaming loses at most a window.** Partial answers and tool output are committed at most every 100 ms by
   default; a crash loses at most that window.
6. **Asking twice is safe.** A submission with a `requestId` that was already admitted returns the existing
   submission instead of submitting again.
:::

## Words used throughout

A **Harness** is one open storage plus the machinery that runs agents on it. A **conversation** is a transcript of
immutable **entries** (a user message `pi.user`, a model response `pi.assistant`, a tool result `pi.tool-result`). A
**commit** is an atomic write of entries, documents and tasks. A **document** is typed JSON state stored next to the
transcript. A **task** is a durable state machine with a **checkpoint** per step; the Harness answers inputs with the
built-in tasks `pi.generation` (one model call) and `pi.tool` (one tool call). A **submission** is something handed to
a conversation and waited for. **Resume** means starting the task scheduler on a reopened storage.

# One Line of Commits {#commits lede="Why every change goes through a single ordered line, and what that buys after a crash."}

Lena's turn produced a handful of records: her message, a system entry, the model's response with two tool calls, a
result for `read`, and a running `bash` call. If these were written independently, a crash could leave any subset on
disk: a tool result without the call that asked for it, or a response whose tool calls have no tasks.

pi-durable writes every change through **one line of atomic commits** per Harness. A commit appends entries, edits
documents and creates or advances tasks together; either all of it is stored or none of it. Nothing is shown to a
watcher, and no task runs, before its commit is stored.

:::sequence animate | One answered input, simplified. Each accent arrow is a commit; nothing after it starts before it is stored.
actor app "app" "submit()"
actor harness "Harness" "the line" accent
actor model "model" "pi-ai"
actor store "storage" "SQLite" muted
app -> harness: submit(input)
harness => store: commit pi.user + generation task
harness -> model: request
model --> harness: tool calls: read, bash
harness => store: commit pi.assistant + two tool tasks
harness -> harness: run read, run bash
harness => store: commit pi.tool-result (read)
:::

So the state after a crash is always one of the states between two commits. In Lena's case the store holds the
response with both tool calls, the finished `read` result and a `bash` task that started but never committed a result.
That is exactly what the Harness needs to decide what to do next.

# Tasks That Remember {#tasks lede="How the model call and the tool calls continue after a restart instead of starting over."}

Work that takes time, a model call or a tool call, is a **task**: a state machine that saves a checkpoint at every
step. The Harness runs an answer as built-in tasks. `pi.generation` calls the model and owns one `pi.tool` task per
tool call; it waits for them and then hands the run to the next generation.

:::flow wide animate | The tasks of Lena's turn. The generation owns the tool tasks and waits for them; each task's state is in storage.
row "Conversation" muted
box conv "conversation" "Lena's root"
box gen "pi.generation" "waiting for its tools" accent
row "Tool tasks" blue
box read "pi.tool read" "done, result committed"
box bash "pi.tool bash" "started, no result" accent
arrow conv -> gen "owns"
arrow gen -> read "owns"
arrow gen -> bash "owns"
note "After the restart, tasks that were running show as pending until they run again."
:::

When Lena restarts the agent, the app reopens the same storage and calls `resume()`:

```ts
const harness = await Harness.open(await openNodeSqliteStorage("./session.sqlite"), { models, registry }, context);
const root = await harness.root(context); // the same root as last time
harness.resume(); // continue any run the last process left unfinished
```

Submitting or waiting starts the scheduler too. The generation task is still waiting for its tools, `read` is done,
and `bash` is the one open question.

:::note | Provider identity survives too
Each conversation has its own persisted UUIDv7 in `pi.provider`, forwarded to pi-ai as the session id for prompt
caching. It survives reopen, retries and model changes, so the provider sees the same session after the restart.
:::

# Tools After a Crash {#tools lede="What happens to a tool call that was running when the process died."}

The `bash` call is the hard case. Its intent was committed before `execute()` ran, so the Harness knows the call
started. It does not know how far it got. Running it again might be harmless (a test suite) or wrong (sending an
email twice). pi-durable does not guess: **the tool declares it.**

:::steps | Reopening with an interrupted bash call
+++ The intent is found
The `bash` task has its intent committed and no result. The process that ran it is gone.
+++ Replay-safe: run again
A tool declared `replay: "safe"` reruns on reopen. A test run is a good candidate: running it twice costs time, not
correctness.
+++ Not replay-safe: tell the model
Any other tool does not run again. The model gets an `interrupted` error result that carries the output committed so
far, and decides itself what to do, for example run the command again.
+++ The turn continues
With every tool task settled, the run continues: the next generation calls the model with both results, and Lena's
turn goes on as if the gap had been a slow tool.
:::

**Output that was streaming.** Partial answers and tool output are committed at most every 100 ms by default
(`settings.progress` changes the intervals). Whatever the model or the tool had produced up to the last progress
commit is in the store; at most that window is lost.

**Nested calls** follow the same rule per call. A tool that calls other tools through `api.executeTool()` gets its
finished nested calls back by key when it reruns; a caller that is not replay-safe never reruns, so its unfinished
nested calls are abandoned before they run again.

:::review | Review: "safe" is a promise, not a check
`replay: "safe"` is the tool author's statement. The README is explicit that a replay-safe tool with external effects
still needs its own idempotency, for example a request id on the external call. The Harness cannot verify it.
:::

# Asking Twice {#requests lede="Why Lena's last message is not sent twice when the app retries it after the restart."}

Lena sent a follow-up just before closing the lid. Her app does not know whether the submit reached the store, so
after the restart it sends it again. Without help, the agent would answer it twice.

A submission can carry a `requestId`. A retried submission with the same id returns the existing submission instead
of submitting twice:

```ts
const submission = await root.submit({ type: "input", content: "Hello", requestId: "greeting-1" }, context);
// After a restart: the same request ID finds the same submission.
const again = await root.submit({ type: "input", content: "Hello", requestId: "greeting-1" }, context);
// again.id === submission.id
```

`harness.submission(id)` finds a submission again by its id, for example to wait for it after the restart. The app's
rule is simple: mint the request id when the user presses Send, keep it until the submit is acknowledged, and reuse it
on every retry.

# What It Does Not Do {.epilogue lede="The limits the README states, and what a host must handle itself."}

- **A storage error ends the Harness.** The call that hit it rejects, everything after it rejects with
  `SessionFailed`, and the Harness closes itself. Nothing is retried; the host reopens. Commits are atomic, so the
  store is consistent, and resubmitting with the same `requestId` finds what was already admitted.
- **One process owns a storage at a time.** There is no cross-process locking; a host that may open the same storage
  twice (two browser tabs, two CLI processes) must prevent it itself.
- **Power loss is weaker than a crash.** SQLite runs in WAL mode with `synchronous = NORMAL`: commits survive process
  crashes, but the newest one may be lost on power or host failure.
- **Code that ignores its abort signal delays close.** Closing waits for running task code to return.

# Reference {.appendix}

| Situation after a restart | What happens |
| --- | --- |
| a commit was stored | it is all there: entries, documents, tasks |
| a commit was in flight | none of it is there |
| a task was running | it shows as pending, then continues from its last checkpoint |
| a tool call started, `replay: "safe"` | it runs again |
| a tool call started, not replay-safe | the model gets an `interrupted` error result with the output so far |
| a task created with `abandonOnRestart: true` | aborted with `abortReason: "restart"`, with everything it owns |
| a submission is retried with the same `requestId` | the existing submission is returned |

# Glossary {.appendix}

**Checkpoint:** the saved state of a task after one step. **Commit:** an atomic write of entries, documents and
tasks. **Conversation:** a transcript of immutable entries. **Document:** typed JSON state stored next to the
transcript. **Entry:** one immutable transcript record. **Harness:** one open storage plus the machinery that runs
agents on it. **Intent:** the commit that records a tool call before it runs. **Replay-safe:** a tool that may run
again after a crash. **Resume:** starting the task scheduler on a reopened storage. **Submission:** an input or a write
handed to a conversation. **Task:** a durable state machine with a checkpoint per step.
