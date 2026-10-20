---
title: Session Sync: a commit log for pi sessions
cover: Session / Sync
kicker: A design book · second edition · 2026-10-20
subtitle: How a pi session leaves one computer, without warning, and carries on somewhere else
stats:
  - 1 | durable commit, one log record
  - ~5 s | worst-case work lost when the lid closes
note: |
  Provenance: what this is based on (files, specs, code read), what state it is in, and how notes marked
  *review* should be read.
colophon: Session Sync · second edition · 2026-10-20 · based on `session-sync.md`
---

# Before we begin {.preface}

A concrete scenario first: a user, a machine, a moment. Then the problem.

## Ten things to know

:::findings
1. **The commit is the unit.** One `Storage.commit(writes)` call, one log record.
2. **The log is written locally.** Commits never wait for the network.
:::

## Words used throughout

A **session** is a pi-durable Session. A **commit** is one atomic batch of writes.

:::note | One seq, this time
An aside that heads off a likely confusion.
:::

# Writing It Down {#outbox lede="The replicating storage, and what happens when the machine dies."}

The first paragraph of a chapter gets the drop cap automatically.

## The commit path

```ts
const seq = await inner.commit(writes); // the commit
await outbox.append({ v: 1, seq, writes });
```

:::flow wide animate | The commit path. The upper row runs inside every commit; the lower row per flush.
row "On the session line" accent
box session "Session" "`commit(writes)`"
box resolve "resolve copies" "`inner.document(src)`" accent
box commit "inner.commit" "SQLite txn → seq"
box append "append" "`current.log`" accent
row "Off the line" blue
box cut "cut" "at a record boundary"
box compact "compact" "drop superseded" blue
box upload "upload" "gateway · R2"
arrow session -> resolve
arrow resolve -> commit
arrow commit -> append
arrow append -> cut "records accumulate"
arrow cut -> compact
arrow compact -> upload
note "Nothing in the lower row runs while the Session line is held."
:::

:::sequence animate | Taking over a session from another device.
actor laptop "laptop" "driver, epoch 3"
actor radius "Radius" blue
actor phone "phone"
phone -> radius: Continue
radius -> radius: write epochs/4/start
radius => phone: epoch 4
note laptop..phone: the laptop's next upload is fenced by the start marker
laptop -> radius: upload batch (epoch 3)
radius --> laptop: refused
:::

:::steps | A flush, step by step
+++ Cut
`current.log` is cut at a record boundary.
+++ Compact
Superseded records are dropped.
+++ Upload
The batch is uploaded; `uploadedHead` advances.
:::

| Case | Recovery |
| --- | --- |
| L &gt; D | replay the outbox tail |
| D &gt; L | upload a snapshot |

:::review | Review: contract and code disagree
Name the file, the claim, and the correct claim.
:::

:::raw
<div id="live-demo" style="padding:1rem;border:1px dashed #c9bfae">Interactive escape hatch: any HTML and <code>&lt;script&gt;</code>.</div>
<script>document.getElementById("live-demo").append(" (script ran)");</script>
:::

# Open Questions {.epilogue lede="What is decided, and what still needs a decision."}

A recap of what is settled.

## Needs a decision

- **Topic.** The question, with the options.

# Reference {.appendix}

## Glossary

- **Term**: definition.
