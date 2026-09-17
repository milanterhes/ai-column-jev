# Batch-run semantics

**Type:** grilling
**Status:** resolved
**Assignee:** milanterhes
**Blocked by:** 01, 03
**Context:** `research/jev-api.md`, `research/job-architecture.md`; inherits from **What confidence means** — the completion summary must count **unable to determine** separately from both **needs review** and **failed**; and from **Preview semantics** — promotion reuses the previewed rows, evaluates only the remainder, and retries failed rows

## Question

Decide the behaviour of a full run over the whole dataset, with Jev's real limits and the job-architecture menu in hand.

Settle:

- **Progress.** What the user sees while running ("Processing 2,914 / 8,242 rows"), how often it updates, and what is shown for rows already failed.
- **Survival.** The run must not depend on the browser being open — confirm what the durable state is and where progress is read from on return. Note the queue's own lease semantics: a worker that dies mid-item is reclaimed after `lockExpiration` (2min) by another worker, and the item is **re-processed**.
- **Retries and partial failure.** What is retried, how many times, with what backoff; how a failed subset is reported without destroying the run; what the retry control offers. **Constraint: `PersistedQueue` gives you none of this for free.** It retries immediately with a hard `maxAttempts` (default 10) and no delay; it has no `run_after`, so delayed retry must be built; and the SQL store keeps exhausted rows in place with no dead-letter list, so "retry the failures" needs a mechanism we design. Decide whether to wrap `take` with our own backoff and exhaustion handling, whether `DurableQueue` covers it, and what the user-facing retry control actually does against the queue.
- **Cancellation and resumption.** Whether a running batch can be stopped, and whether a stopped or crashed batch resumes or restarts.
- **Concurrency and rate limits.** How many evaluations are in flight, and what happens when Jev throttles. Jev publishes **no** rate-limit number, so decide the conservative default and how it is tuned without guessing. Note also that Jev documents **no idempotency**, so the runner must not depend on re-sending a call being free of duplicates.
- **Completion summary.** The exact figures shown when the run finishes: per-answer distribution, high-confidence count, needs-review count, failed count.
- **Usage.** The expected-cost line shown before the run, and what the run records for rows × columns (Q6=A).

## Answer

**Unit of work: one queue item per *(row, AI column)*.** A 8,242-row run is 8,242 items. Per-row items give exact progress, minimal retry granularity, and a duplicate cost that rounds to nothing — Jev is **$0.042/M input tokens with output free**, so even replaying a row is a fraction of a cent. *(Rejected: one item per chunk, where a replay re-evaluates fifty rows; and one item per run, where a worker crash restarts everything.)* The batching that the vendor's cookbooks demonstrate is recovered **inside the adapter**, not at the queue: an Effect `RequestResolver` coalesces concurrent row evaluations into few Jev requests. **The evaluation-service boundary** owns that shape and must not contradict this.

**Retries split into retryable and terminal, with a persisted rate limiter in front.**

- **In front:** every Jev call passes through `RateLimiter` using **`adaptiveConsume` / `adaptiveFeedback`**, reporting the response status and `Retry-After` back into the limiter. Jev publishes **no** rate-limit number, and the adaptive limiter treats that as a learning problem rather than a guessing one — that is the whole reason to use it. `onExceeded: "delay"` means the limiter waits *before* sending, so it prevents `429`s rather than reacting to them.
- **Retryable** — `429`, `529`, overload, timeout, connection failure: sleep with exponential backoff honouring `Retry-After`, **then** return failure, so the queue's next attempt is naturally delayed. Holding the worker slot during that sleep is correct backpressure, not a hack: under rate limiting you *want* the runner to slow down.
- **Terminal** — `422`, malformed criteria, invalid labels: **write the row's Result as failed and let the handler succeed**, so it never burns a retry attempt. Ten pointless calls per malformed rule is the alternative.
- **Exhaustion:** when attempts run out the row simply stays failed. There is no dead-letter list in the SQL store, so the user-facing **"retry failed rows"** control **re-offers new items with fresh ids**. No scheduling infrastructure is built.

**Fairness across users — one queue per user, round-robin, with reserved interactive capacity.** `PersistedQueue` claims **strict FIFO within a `queue_name`** (`ORDER BY updated_at, sequence`), with no priority and no weighting. A single shared queue therefore means head-of-line blocking: another user's 1,000-row run is claimed ahead of a ten-row preview enqueued a second later, and if the worker's concurrency is saturated by that run, fair selection alone would not help either.

The design:

1. **One queue name per active user**, since the harm is one user's bulk work delaying another user's work — a between-users problem, not a between-runs one.
2. **A round-robin claim loop** in the worker: it maintains a rotating list of active users and fills each free slot from the next user in turn, so no single user monopolises a pass.
3. **A small number of concurrency slots reserved for interactive work** — previews and short runs — so preview latency is guaranteed even in the worst case, not merely likely.

Exact slot counts and poller strategy are the builder's call and tunable; the spec carries the *shape*: per-user queues, round-robin selection, reserved interactive capacity.

> **Accepted risk — recorded deliberately.** This was decided by reasoning, not measurement, and the open question was what N queue instances cost, since each runs its own 1s poll fiber. If fairness or poller overhead misbehaves in practice, this is the first decision to revisit, and the right instrument is a prototype measuring `PersistedQueue` against Postgres with many queue names.

**Redis is added as infrastructure** for the limiter's state (see map Notes). Without it, `RateLimiter` offers only a process-local memory store, which would give the web and worker processes uncoordinated rate budgets against an unknown limit.

**Everything that calls Jev goes through the queue — including preview.** Preview enqueues its ten rows and the browser polls for completion, rather than calling Jev synchronously from the web process. This makes **Preview semantics**' "preview is the same pipeline as the full run" *literally* true, and makes the adaptive limiter's learning shared rather than split in two. The cost is asynchrony, which the browser already needs for batch progress anyway.

**Cancellation: a `cancelled` flag on the run**, checked by the handler as its first act. In-flight rows finish; every remaining item no-ops through the queue quickly. *(Rejected: deleting the run's pending rows out of the queue's own table, which couples us to a library's private schema and breaks on upgrade.)*

**Progress is derived from the results table**, never counted separately — counts by status, queried on demand, with the run row holding only status and timestamps. A counter would be a second source of truth that drifts the first time the queue replays an item, which it *will* do. The browser polls every couple of seconds via TanStack Query: it survives a reload with no reconnect logic, and the base already has TanStack Query.

**"Completed" means every row reached a terminal state** — including failed ones. Run status is `running | completed | cancelled | failed`, with `failed` reserved for the run being unable to proceed at all (the column was deleted mid-flight). A run with 8,241 good rows and one timeout reports as **completed**, because a failed subset must never destroy the whole run.

**The summary** reports the per-answer distribution, then the **four status counts separately** — high confidence, needs review, unable to determine, and failed. A single "success rate" would hide exactly the information the product exists to preserve: those four states have four different user actions.

**Usage** is reported as **evaluations** (`rows × columns`), with a **dollar estimate shown only once a preview has run**, because that is the first moment we have measured real `usage.input_tokens` per evaluation. Quoting a figure before measuring would be a guess dressed as a number.

### Handed to other tickets

- **The evaluation-service boundary** must: accept a row's *content* (not a stored row id), expose one entry point for preview and full run differing only in row count, provide the batching `RequestResolver`, and own the `RateLimiter` wrapping and the retryable/terminal error translation.
- **Stand up the stripped base** must provision **Redis** alongside Postgres.
- **Dataset privacy and lifecycle** inherits: cancellation and retry are user actions on the run, and nothing here deletes rows.
- **Unresolved detail:** with Redis present, whether the `PersistedQueue` store *also* moves to Redis is not decided here and is recorded in the map's fog.
