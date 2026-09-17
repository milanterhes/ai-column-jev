# Background-job architecture and hosting target

**Resolves:** [Background-job architecture and hosting target](../issues/03-research-job-architecture.md) (wayfinder map `semantic-spreadsheet`)
**Verified:** 2026-09-17, against first-party docs, pricing pages, and repositories.
**Purpose:** give the *batch-run semantics* decision a real menu with real trade-offs. **No winner is chosen here.** Where a claim rests on a secondary source or is internally inconsistent, it is flagged.

---

## 1. The workload this has to carry

Take a concrete, deliberately round number and hold it constant so costs are comparable:

| Assumption | Value |
| --- | --- |
| Rows per full run | 5,000 |
| Full runs per day | 3 |
| Days per month | 20 |
| **Row-evaluations / month** | **300,000** |

"Row-evaluation" is the usage unit the brief already commits to (rows × columns). One run is minutes to tens of minutes; the process must outlive the browser tab; failures must be retried and reported as partial, not fatal.

The single most important variable for cost is **how many rows you put in one unit of work**. Everything priced per execution (Inngest step, Trigger run, QStash message) is ~100× cheaper if you batch 100 rows per unit. Call them:

- **Scenario A — one unit per row:** 300,000 units/month.
- **Scenario B — 100 rows per unit:** 3,000 units/month.

The real Jev rate limits and per-call latency (ticket *The real Jev / TypeSafe evaluation API*) set the practical batch size. This document does not assume one.

---

## 2. The constraint that rules things out first: execution-time limits

### Vercel Functions (fluid compute, enabled by default for new projects)

| Plan | Default | Maximum | Extended max |
| --- | --- | --- | --- |
| Hobby | 300s (5 min) | 300s (5 min) | — |
| Pro | 300s (5 min) | 800s (~13.3 min) | 1800s (30 min) **Beta** |
| Enterprise | 300s (5 min) | 800s | 1800s (30 min) **Beta** |

Source: Vercel [Functions limits](https://vercel.com/docs/functions/limitations) and [Configuring maximum duration](https://vercel.com/docs/functions/configuring-functions/duration), both `last_updated` 2026-08. Values above 800s are beta, require per-function configuration, are limited to specific Node.js/Bun/Python runtimes, and are unavailable with Secure Compute / Static IPs.

Other limits that matter here:

- Request/response body: **4.5 MB** (a 5,000-row CSV can exceed this; uploads should go direct to blob storage, not through a function body).
- Cron: **Hobby — 100 cron jobs but once per day minimum, ±59 min precision; Pro — once per minute, per-minute precision.** A cron expression running more than daily *fails deployment* on Hobby. Source: Vercel [Cron usage & pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing), `last_updated` 2026-07-15.
- Hobby is described as "for personal, non-commercial use"; commercial products need Pro at **$20/month + 1 included deploying seat** ($20/month in included usage credit). Source: [Vercel Pro plan](https://vercel.com/docs/plans/pro-plan), [Vercel pricing](https://www.vercel.com/pricing).
- WebSocket support is in **public beta**; Edge functions must begin responding within 25s and can stream up to 300s.

**Ruled out by these limits**

1. *Running an entire multi-minute/tens-of-minutes batch inside a single Vercel Function invocation.* Hobby's hard 300s ceiling makes it impossible; Pro's GA ceiling is 800s (~13 min), so "tens of minutes" is not achievable without the beta 30-min path, which is not a safe foundation. The only honest serverless shapes are **chunked work per invocation** or **compute moved off Vercel** (Trigger.dev's managed workers, or a container host).
2. *Platform cron alone on Hobby* as the engine for prompt work — once-daily, ±59 min.
3. *Vercel Hobby as production host for a paid product* — non-commercial only.

### 2026 caveat that changes the ceiling

Vercel now ships **Vercel Workflows** (durable `'use workflow'` / `'use step'` code, pause/resume for minutes to months, "no duration limits") backed by **Vercel Queues**, billed on events/data written/data retained. This is a fifth, Vercel-native option adjacent to the four families below, and it materially weakens the "serverless can't do long runs" rule. It is not in the ticket's family list, so it is noted but not scoped. Source: Vercel [Workflows docs](https://vercel.com/docs/workflows), `last_updated` 2026-09-04.

---

## 3. Family 1 — Managed workflow / queue services

The defining axis across this family: **whose compute runs the work, and therefore whose timeout applies.**

### 3.1 Inngest

**What it is.** A durable-execution orchestrator. `step.run()` wraps your code; completed steps are memoized and retried independently; a function run survives between steps. It is **not** a compute host — your functions run on **your** infrastructure ("serverless workers: serverless endpoints for your apps"). Step timeouts are bounded by both Inngest's max and *your hosting provider's timeout*.

**What must be deployed.** Your Next.js app exposing an Inngest serve endpoint; the Inngest SDK; Inngest Cloud (or self-hosted Inngest, which is open source). No queue/worker process of your own.

**Free tier / cost.** Hobby **$0**: 50k executions/month, **5 concurrent steps**, 500k events, 500 MB span data, 50 realtime connections, 3 users. Pro **from $99/month**: 1M executions, 100+ concurrent steps, 5M+ events, 1,000 realtime connections, 7-day trace retention. (Third-party 2026 trackers also cite an intermediate "Basic" ~$50 plan; the live pricing page shows only Hobby/Pro/Enterprise, and Inngest's own usage-limits table still lists a "Basic" column — treat Basic as **unverified/legacy**.)

Cost at MVP scale:
- **Scenario B (batched):** ~60 runs + ~3,000 steps ≈ **3,060 executions → free tier**, comfortable. Watch the free **5-concurrent-step** cap — it throttles throughput.
- **Scenario A (one step/row):** ~300,060 executions → over free; **Pro $99/month** (1M included). Also hits the documented platform limit of **1,000 steps per function**, so per-row stepping must be chunked anyway.

**Progress to the browser.** First-class **Realtime**: channels + typed topics, publish from inside a function (`step.realtime.publish()` durable, or `inngest.realtime.publish()` transient), subscribe in React via `useRealtime` with server-minted subscription tokens. Hobby includes 50 realtime connections (250k messages/day); Pro 1,000 (1M/day). Polling your own DB also works.

**Cancellation / resumption.** Cancel via API, dashboard bulk-cancel, or `cancelOn` events. Critical semantics: **a currently-executing step is not interrupted — it runs to completion**; cancellation takes effect between steps. Canceled runs can be replayed. Sleeps up to a year (7 days on free).

**Retries / partial failure.** Default **4 retries after the initial attempt** (5 attempts total), exponential backoff with jitter, **per step independently**; step results are memoized so earlier successes are not re-run. `retry: 0` disables; non-retriable errors supported; failure handlers run after retries are exhausted; try/catch can recover a failed step (e.g., fall back to a different model). Function run max length: Free 30 days / Basic 90 / Pro 366. Step timeout up to **2 hours** but bounded by your host (so a Vercel Hobby step is really ≤300s).

**What breaks / gets awkward.** Compute stays yours, so Vercel's 5-minute/13-minute ceiling still caps any single step; the free 5-step concurrency is a real throughput limiter; per-row stepping blows both the free execution budget and the 1,000-steps-per-function limit; execution metering is by *step*, so fan-out multiplies the bill quickly; vendor lock-in is real though the engine is self-hostable.

### 3.2 Trigger.dev

**What it is.** A managed task platform: **tasks execute on Trigger.dev's managed workers** ("no timeouts and no infrastructure to manage"). Your Next.js app triggers and subscribes; it does not run the work.

**What must be deployed.** Just the Trigger.dev project + `@trigger.dev/sdk` + a `trigger/` folder. No worker to run. (Self-hostable, Apache-2.0, if you want the infra.)

**Free tier / cost.** Free **$0**: **$5/month of included credits**, 20 concurrent runs, unlimited tasks, 10 schedules, 1-day log retention; **once the $5 is used, tasks stop until you upgrade**. Hobby **$10/month** ($10 credits, 50 concurrent); Pro **$50/month** ($50 credits, 200+ concurrent). Metering is **per-second compute** (Small-1x default $0.0000338/s) **plus $0.000025 per run invocation** ($0.25/10k runs). Waiting/checkpointing does not bill compute. Source: Trigger.dev [pricing](https://trigger.dev/pricing), [limits](https://trigger.dev/docs/limits).

Cost at MVP scale:
- **Scenario B:** ~3,000 runs × ~10s Small-1x = 3,000 × ($0.000338 + $0.000025) ≈ **$1.09/month → free tier**.
- **Scenario A:** 300,000 runs × ~1s = 300,000 × $0.0000588 ≈ **$17.6/month** (Hobby $10 + overage).
- Compute scales with wall-time, so batching into longer tasks is only cheaper if it does not increase total compute-seconds (it usually *does* reduce per-run invocation overhead, which is the point).

**Progress to the browser.** **Realtime**: `useRealtimeRun` for status/metadata (subscribe to run state; write progress into run metadata) and `useRealtimeStream` for token/data streams. No polling/WebSockets needed by you; it runs over Electric SQL (HTTP-based Postgres sync) and its own stream transport. Free: 10 concurrent Realtime connections; Hobby 150; Pro 1,000+. You can also use `runs.list()`/`runs.retrieve()` polling.

**Cancellation / resumption.** `runs.cancel(runId)` (API or dashboard) stops execution, marks CANCELED, **does not retry**, and cancels child runs. Runs are checkpointed, so a crash resumes from the last checkpoint; `runs.replay(runId)` re-runs with the same payload. Queued runs have a **14-day max TTL** on Cloud; dev runs 10 min; `ttl: 0` opts out.

**Retries / partial failure.** Default **`maxAttempts: 3`**, factor 2, 1s→10s, randomized (config-level default, overridable per task). `AbortTaskRunError` / `UnrecoverableError`-style abort prevents retry; `catchError` can inspect the error and choose `skipRetrying` or `retryAt` (e.g., honor `Retry-After`). `retry.onThrow()` retries a block; `retry.fetch()` retries HTTP by status/timeout. Per-task child tasks give independent retry + independent dashboard retry. **Bulk replay of failed runs** by filter after a fix.

**What breaks / gets awkward.** Managed compute moves your timeout problem away — this is the family's biggest advantage. But: cost is wall-clock compute (long waits without `wait.for`/checkpoints bill); concurrency (20 free) caps fan-out; you take on a proprietary runtime and a second deployment target; 1-day free log retention hampers post-mortems.

### 3.3 Upstash QStash (and Upstash Workflow)

**What it is.** A serverless **push** message queue + scheduler. It delivers HTTP requests to your endpoint with retries, delays, cron, DLQ, dedup, and flow control. **Compute is yours** — QStash only calls your endpoint. (Upstash **Workflow** is a durable-execution layer built on QStash, billed per step/message.)

**What must be deployed.** Your app exposing authenticated callback routes; a QStash token. Nothing else.

**Free tier / cost.** **Free: 1,000 messages/day, 50 GB bandwidth, 1 MB max message, 10 active schedules, 2 queue parallelism, 15-min max HTTP response.** Pay-as-you-go: **$1 per 100,000 messages**, unlimited/day, 10 MB messages, 100 queue parallelism, 100 active schedules, **2-hour max HTTP response**. Fixed 1M $180/mo, 10M $420/mo. Source: Upstash [QStash pricing](https://upstash.com/pricing/qstash). Schedules beyond 1,000 are $0.01 each.

Cost at MVP scale:
- **Scenario B:** ~3,000 messages → **free tier** (well under 1,000/day).
- **Scenario A:** ~300,000 messages ≈ **$3/month** PAYG; free tier covers only ~30k/month.

> **Flag — Upstash contradicts itself on retry billing.** The QStash pricing page states "You are only charged for messages — retries are free" and "only published messages count", but its own FAQ on the same page says "one delivery attempt to one endpoint equals one billed message… since there were two delivery attempts, the message is billed as 2 messages." A third-party tracker repeats the per-attempt reading. **Treat retry billing as unverified**; budget as if retries bill, since a flaky Jev endpoint would otherwise surprise the invoice.
>
> **Flag — DLQ retention depends on plan** (free 3 days, PAYG 7 days, Fixed 30 days), so a holiday-weekend failure could expire before you look.

**Progress to the browser.** None built in. QStash has no job store to query; "progress" is whatever your callback writes to your own Postgres (`BatchRun.completedRows`) and your own polling/SSE endpoint. The flow-control management API exposes waitlist/parallelism counts, not per-run progress.

**Cancellation / resumption.** No job model to cancel in the durable sense — QStash delivers a message and forgets. You can delete scheduled messages, pause/resume a flow-control key (messages held in waitlist), and republish from the DLQ. Real cancellation and resumption are **your** BatchRun state plus idempotent callbacks.

**Retries / partial failure.** Default **3 retries** with `Upstash-Retries`, exponential backoff `min(86400, e^(2.5n))` (12s, 2m28s, 30m, 6h, 24h), optional `Upstash-Retry-Delay` expression, honors `Retry-After`/`X-RateLimit-Reset`. Non-retryable errors via HTTP 489 + `Upstash-NonRetryable-Error` header. DLQ with manual retry/delete. **Flow control** gives per-key rate + parallelism limits (the natural way to respect Jev rate limits).

**What breaks / gets awkward.** You still own all run state, progress, cancellation, and partial-failure reporting in Postgres; callbacks must be idempotent (at-least-once push); a callback must return within the plan's max HTTP response duration (15 min free / 2 h PAYG) — fine for chunked callbacks, dangerous for whole-batch ones; DLQ retention is plan-bound; retry billing is ambiguous.

---

## 4. Family 2 — Postgres-backed polling workers

Both are OSS, MIT, and use the Postgres you already need. Both require a **long-lived Node process** to be the worker (`work()` loop / standalone worker) — which is exactly what pure-Vercel serverless cannot host. pg-boss additionally offers an explicit `fetch()` path that a serverless invocation can drive; graphile-worker's LISTEN/NOTIFY model wants a persistent connection.

### 4.1 pg-boss

**What must be deployed.** `pg-boss` in your app; its schema in Postgres; and a process to run workers (VPS/container normally, or a cron/route driving `fetch()` on serverless). No extra service. Includes a CLI, a dashboard package (`@pg-boss/dashboard`), and an HTTP proxy package for pooling/serverless compatibility. Requires Node ≥22.12 and Postgres ≥13 (both satisfied locally: Node 24 installed).

**Free tier / cost.** Software is free. Marginal infra cost is the worker host. At MVP a worker rides the same Railway/Fly/VPS as the app (~$5/month, see §6), or rides Vercel Pro cron for $0 incremental (but then you run bounded `fetch()` batches, not `work()`).

**Progress to the browser.** No per-job progress field and no `updateProgress` API. You get job `state`, timestamps, and `output`, plus `getQueueStats()` snapshots (queuedCount, deferredCount, readyCount, activeCount, failedCount) and a `jobs` view. Progress for "2,914 / 8,242 rows" is naturally **your own** `BatchRun.completedRows` counter written by the handler; the browser polls your endpoint.

**Cancellation / resumption.** Explicit `cancel(name, id)` / `resume(name, id)` / `retry(name, id)` (single or batch, best-effort on arrays). Running handlers are not interrupted — your code must observe cancellation. Resumption is inherent: active jobs that die are retried (heartbeat detects dead workers, expiration caps attempt length; defaults: expiration 15 min, heartbeat disabled). DLQ + `redrive()` returns dead-lettered jobs to their source queues with reset retries.

**Retries / partial failure.** Exactly-once delivery via `SKIP LOCKED`; default **retryLimit 2** (3 attempts), `retryDelay 0`, `retryBackoff false`; opt-in exponential backoff with jitter (`retryDelay * 2^retryCount`) and `retryDelayMax`. Per-job state makes partial failure first-class. Retention defaults: 14 days for created/retry, 7 days for completed.

**What breaks / gets awkward.** No first-class progress or `updateProgress`; no built-in UI for the product's progress bar (dashboard is for operators). The worker is a process you must host and keep alive — if you refuse a container/VPS, you must drive `fetch()` from cron and reimplement the loop. Serverless compatibility is advertised, but the natural home is a long-lived process.

### 4.2 graphile-worker

**What must be deployed.** `graphile-worker` (standalone CLI or embedded in your Node process — can share the app's process to keep devops low); its schema in Postgres. Node/Postgres app. Requires a persistent process particularly for the low-latency LISTEN/NOTIFY path.

**Free tier / cost.** Software free (MIT, community-funded). Cost is again the worker host (~$5/month) — or $0 extra if embedded in an already-running container.

**Progress to the browser.** None built in. Job state lives in `graphile_worker.jobs` (and a `jobs` view); you write your own progress and poll it. No per-job progress API.

**Cancellation / resumption.** No first-class cancel/resume API. You delete/mark queued jobs and have running tasks check a cancellation flag; a running task is not interrupted. Resumption is robust: at-least-once with transactional guarantees; on graceful shutdown (`SIGTERM`) the worker stops accepting, finishes in-flight jobs, then exits (forceful shutdown after 5s marks running jobs failed to retry elsewhere). On an unhandleable kill, jobs stay locked for **at least 4 hours**, then a periodic sweep (every 8–10 min) releases them — recoverable but slow until you clear `locked_at`/`locked_by`.

**Retries / partial failure.** Automatic retries with exponential backoff, **default 25 attempts over ~3 days** (customizable); job de-duplication via unique `job_key`; batch jobs; crontab scheduling with optional backfill; `runTaskListOnce` for testing. Failed subset does not destroy the batch — each job is independent.

**What breaks / gets awkward.** Least "product-shaped" of the Postgres options: no progress API, no cancel/resume API, no bundled UI; the 4-hour lock on hard kill can strand rows; LISTEN/NOTIFY wants a long-lived connection, so a pure serverless deployment is a poor fit. In exchange it is small, fast (~3 ms schedule→execute latency claimed, `SKIP LOCKED`), and embeds into your process.

---

## 5. Family 3 — Redis-backed BullMQ (with a new Postgres backend)

**What it is.** A Node queue library on Redis (or, as of a newer release, an **optional PostgreSQL backend** with the same `Queue`/`Worker`/`QueueEvents`/`FlowProducer` API). Redis remains the default and "most battle-tested". The Postgres backend maps jobs to tables, uses `LISTEN/NOTIFY` for the blocking wait, and measures ~1.5–2× lower processing throughput than Redis; migrations are explicit (`runMigrations`).

**What must be deployed.** A **long-lived worker process** (BullMQ's design is connection-holding), plus **Redis** — unless you use the new Postgres backend, which removes the Redis dependency. `QueueEvents` for completion/progress events; optionally a UI (e.g., Bull Board) for operators. Environment note: **no Redis is running locally**, so either add a Redis container or choose the Postgres backend.

**Free tier / cost.** Library free (MIT). Cost = worker host + Redis. Upstash Redis free tier: **256 MB, 500k commands/month, 10 GB bandwidth**; PAYG **$0.2 per 100,000 commands**, fixed 250 MB **$10/month**. Beware command-metering: a polling/idle queue still consumes commands. At MVP this is likely **$0** if load is low, or ~$10/month fixed. If you run the worker on Railway/Fly (~$5/month) the total is ~$5–15/month.

**Progress to the browser.** **`job.updateProgress()`** is first-class; progress is stored and readable. `QueueEvents` emits progress/completed/failed events you can bridge to SSE/WebSocket, or the client polls `job.progress()`. This is the only family with a built-in per-job progress primitive.

**Cancellation / resumption.** **`worker.cancelJob(id, reason)` / `cancelAllJobs()`**, delivered via `AbortController`/`AbortSignal` to the processor — you can pass the same signal to `fetch()` so the network call is truly aborted. Throw a regular `Error` to allow retry, or `UnrecoverableError` to make cancellation permanent. Lost locks are handled by the stalled-job checker, which returns the job to `waiting`.

**Retries / partial failure.** `attempts` + built-in **fixed** or **exponential** backoff with optional jitter, or a custom `backoffStrategy` (return `-1` to stop retrying). Global **rate limiting** (`limiter: { max, duration }`) and `worker.rateLimit(duration)` + `Worker.RateLimitError()` to back off on upstream 429s. Failed jobs land in the failed set (retained per auto-removal settings). Partial failure maps cleanly to per-job state.

**What breaks / gets awkward.** Requires a persistent worker process; the natural Redis path adds a second stateful dependency (though the Postgres backend now removes it); throughput is far above this workload's needs (overkill); rate limiting is global per queue (group keys were removed in v3); Bull's UIs are operator-facing, not a product progress bar.

---

## 6. Family 4 — Platform cron + a DB-claimed work queue

**What it is.** You build the queue: a `jobs`/`batch_chunks` table in Postgres, claimed with `FOR UPDATE SKIP LOCKED` (or an atomic `UPDATE ... WHERE status='pending'`), processed in bounded batches by an HTTP route, advanced by a scheduler. All run/progress state lives in your existing schema; the browser polls it.

**What must be deployed.** Your app + Postgres + a scheduler. On Vercel: `vercel.json` crons (or an external pinger) hitting a protected route. Elsewhere: system cron / the platform's scheduler.

**Free tier / cost.** No vendor free tier — it is your code. Realistically **Vercel Pro $20/month** (needed for commercial use and per-minute cron; Hobby is once-daily) **or** a cheap container/VPS (~$5/month) whose own cron drives it. External free cron pingers can remove the Vercel-cron requirement but not the function-duration limit.

**Progress to the browser.** Trivially your own `BatchRun` row — exactly the shape the brief already specifies. Universal and framework-free: polling, SSE, or WebSockets all read the same table.

**Cancellation / resumption.** You implement a `cancelled` flag; workers check between chunks. Resumption is natural if each chunk is idempotent and re-claimable, but **you** own lease expiry / visibility timeout / idempotency / retry counters / dead-lettering.

**Retries / partial failure.** You implement attempt count, backoff (`next_attempt_at`), and failure recording. Partial failure is whatever you record. No defaults to lean on.

**What breaks / gets awkward.** This is the most code and the fewest external dependencies. The classic failure modes are self-inflicted: double-claiming, stuck "active" rows after a crash, missing idempotency, run-away retries, and — on Vercel — the 300s/800s wall plus Hobby's once-daily cron. If the target host is a container, this family converges toward "just use pg-boss," which is this family with the hard parts pre-solved.

---

## 7. Hosting contexts

| Context | Fits which families | Notes |
| --- | --- | --- |
| **Vercel serverless** | Managed services (Inngest, Trigger.dev, QStash) and chunked DB-queue (`fetch()`/route batches) | Per-invocation ceiling 300s (Hobby) / 800s GA (Pro) / 1800s beta. Cron once-daily on Hobby. 4.5 MB body cap. Commercial use needs Pro $20/mo. WebSockets public beta. |
| **Long-lived container / VPS** | pg-boss, graphile-worker, BullMQ natively; DB-queue | Worker process loops are the natural fit. Railway Hobby $5/mo incl. $5 credit (Pro $20); Fly.io shared-cpu-1x 256 MB ≈ $2.02/mo, 1 GB ≈ $5.92/mo, plus ~$0.15/GB-month volumes. Source: [Railway pricing](https://railway.com/pricing), [Fly.io pricing](https://fly.io/docs/about/pricing/). |
| **Docker** | Everything | Compose app + worker + Postgres (+ Redis if BullMQ/Redis). Local constraint: **host port 5432 is already taken by an unrelated Postgres** — run this project's Postgres on another port or in an isolated compose network; **no Redis container is running**, so BullMQ's Redis path needs one added (or use BullMQ's Postgres backend / Upstash). |

Note: Trigger.dev and Inngest both also permit **self-hosting**, which relocates their compute to your container — turning "managed" into "self-hosted" with your own ops burden.

---

## 8. Side-by-side

| | Inngest | Trigger.dev | QStash | pg-boss | graphile-worker | BullMQ (+Redis) | Platform cron + DB queue |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Extra infra to run | none (your endpoints) | none (their workers) | none (your endpoints) | worker process + PG | worker process + PG | worker process + Redis (or PG backend) | scheduler + PG |
| Compute host / timeout owner | you / your host | Trigger.dev | you / your host | you | you | you | you / platform |
| Progress primitive | Realtime channels/SSE | run metadata + Realtime | none (roll your own) | none (roll your own) | none (roll your own) | `updateProgress` + QueueEvents | your table |
| Cancel running work? | between steps only | yes (`runs.cancel`) | pause/delete/DLQ; not true cancel | flag + API; not preemptive | flag only | `AbortSignal` | your flag |
| Default retries | 4 (per step) | 3 (per task) | 3 messages | 2 (per job) | 25 (~3 days) | opt-in `attempts` | you |
| Partial-failure model | per step | per task/attempt | per message + DLQ | per job + DLQ/redrive | per job | per job | you |
| Free tier | 50k exec/mo, 5 concurrent | $5 credits, 20 concurrent | 1k msg/day | OSS | OSS | OSS + Upstash Redis free | OSS |
| MVP cost (A 300k units) | $99/mo | ~$18/mo | ~$3/mo | ~$5–20/mo (host) | ~$5–20/mo (host) | ~$5–15/mo (host+Redis) | ~$5–20/mo (host) |
| MVP cost (B 3k units) | $0 | $0 ($5 credit) | $0 | ~$5–20/mo (host) | ~$5–20/mo (host) | ~$5–15/mo (host+Redis) | ~$5–20/mo (host) |
| Lock-in | high (engine OSS) | high (Apache-2.0, self-host) | low-medium | none | none | none | none |

MVP costs are the *marginal* job-layer cost and exclude the app/DB host, the product's Postgres, and Jev itself. Scenario A/B as defined in §1.

---

## 9. Strictly ruled out by the stated constraints

- **A single serverless invocation running a whole batch.** Hobby 300s hard; Pro 800s GA. Contradicts "minutes to tens of minutes." Ruled out. (Chunked invocations or off-platform compute are the only serverless shapes.)
- **Platform cron as the only trigger on Vercel Hobby.** Once-daily + ±59 min precision, and expressions above daily fail deploy. Ruled out for prompt/ongoing progress.
- **Vercel Hobby for a commercial SaaS.** Non-commercial use only → Pro required.
- **BullMQ on the Redis path with no Redis anywhere.** No local Redis container is running; you must deploy or rent one (or use BullMQ's Postgres backend).
- **Relying on `work()`/standalone workers (pg-boss, graphile-worker, BullMQ) inside pure Vercel serverless.** They need a persistent process; in a Vercel-only deployment they are ruled out unless replaced by a poll/`fetch()` pattern or moved to a container host.
- **Using local Postgres on 5432 as-is.** Occupied by an unrelated container; any Postgres-backed option needs a distinct container/port. (Dev-environment constraint, not a family disqualifier.)

Everything else — all four families — is genuinely available, differing mainly in *whose compute* runs the work and *how much queue machinery you own*.

---

## 10. Open questions / verified-but-uncertain

- **Jev's real rate limits and max batch size** (ticket *The real Jev / TypeSafe evaluation API*) determine Scenario A vs B and therefore which rows in §8 apply. Cost figures are only as good as that batch size.
- **QStash retry billing** is internally contradictory on Upstash's own pricing page (see §3.3) — unverified.
- **Inngest "Basic" plan** (~$50/mo) appears in third-party trackers and Inngest's own usage-limits table but not on the live pricing cards — unverified/possibly legacy.
- **Vercel 30-minute extended max duration** and **WebSocket support** are both in beta as of 2026-09.
- **Vercel Workflows/Queues** are a new, Vercel-native durable option outside the ticket's four families and may deserve their own evaluation if the hosting target stays Vercel.
- **Trigger.dev free concurrency** is stated as 20 on the official pricing page; an older third-party source says 10 — official figure used.

---

## Sources

Primary (official docs / pricing / repositories), verified 2026-09-17:

- Vercel — Functions limits: https://vercel.com/docs/functions/limitations
- Vercel — Configuring maximum duration: https://vercel.com/docs/functions/configuring-functions/duration
- Vercel — Fluid compute: https://vercel.com/docs/fluid-compute
- Vercel — Cron jobs usage & pricing: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Vercel — Pro plan: https://vercel.com/docs/plans/pro-plan
- Vercel — Pricing: https://www.vercel.com/pricing
- Vercel — Workflows: https://vercel.com/docs/workflows
- Inngest — Pricing: https://www.inngest.com/pricing
- Inngest — Usage limits: https://www.inngest.com/docs-markdown/usage-limits/inngest
- Inngest — Automatic retries: https://www.inngest.com/docs/features/inngest-functions/error-retries/retries
- Inngest — Error handling & retries: https://www.inngest.com/docs/guides/error-handling
- Inngest — Cancellation: https://www.inngest.com/docs/features/inngest-functions/cancellation
- Inngest — Realtime: https://www.inngest.com/docs/features/realtime
- Trigger.dev — Cloud pricing: https://trigger.dev/pricing
- Trigger.dev — Limits: https://trigger.dev/docs/limits
- Trigger.dev — Errors & retrying: https://trigger.dev/docs/errors-retrying
- Trigger.dev — Runs (lifecycle, cancel, TTL, replay): https://trigger.dev/docs/runs
- Trigger.dev — Realtime overview: https://trigger.dev/docs/realtime/overview
- Trigger.dev — trigger.config.ts: https://trigger.dev/docs/config/config-file
- Upstash — QStash pricing: https://upstash.com/pricing/qstash
- Upstash — QStash retries: https://upstash.com/docs/qstash/features/retry
- Upstash — QStash dead letter queues: https://upstash.com/docs/qstash/features/dlq
- Upstash — QStash flow control: https://upstash.com/docs/qstash/features/flowcontrol
- Upstash — Workflow pricing: https://upstash.com/docs/workflow/pricing
- Upstash — Redis pricing (free tier / PAYG): https://www.upstash.com/pricing
- pg-boss — Repository: https://github.com/timgit/pg-boss
- pg-boss — Docs home: https://pgboss.io/
- pg-boss — Queues API (retry/DLQ/heartbeat/expiration): https://pgboss.io/api/queues
- pg-boss — Jobs API (cancel/resume/retry, states): https://pgboss.io/api/jobs
- graphile-worker — Repository: https://github.com/graphile/worker
- graphile-worker — Docs: https://worker.graphile.org/docs
- graphile-worker — Error handling: https://worker.graphile.org/docs/error-handling
- BullMQ — Docs home: https://docs.bullmq.io/
- BullMQ — Retrying failing jobs: https://docs.bullmq.io/guide/retrying-failing-jobs
- BullMQ — Cancelling jobs: https://docs.bullmq.io/guide/workers/cancelling-jobs
- BullMQ — Rate limiting: https://docs.bullmq.io/guide/rate-limiting
- BullMQ — PostgreSQL backend: https://docs.bullmq.io/guide/postgresql
- Railway — Pricing: https://railway.com/pricing
- Fly.io — Resource pricing: https://fly.io/docs/about/pricing/

Secondary (used only for triangulation; figures taken from primary where they conflict):

- Vercel 30-min update coverage (induwara.lk, 2026-06-23) and Vercel changelog "Higher defaults and limits…" (2025-06-25).
- Trigger.dev pricing analysis (usagepricing.com, 2026-06-16; ZenML) — cross-checked against official pricing.
- Inngest/Basic plan trackers (budgetforge.dev, freetier.co, latest.sh, 2026-08) — flagged unverified.
