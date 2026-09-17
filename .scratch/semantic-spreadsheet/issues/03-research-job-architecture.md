# Background-job architecture and hosting target

**Type:** research
**Status:** resolved
**Blocked by:** —

## Question

What is a low-operational-complexity architecture for long-running batch runs — thousands of rows, minutes to tens of minutes, must survive the browser closing, must retry and report partial failure — for a solo founder?

Survey the realistic families and the hosting contexts each assumes:

- managed queues/workflow services: Inngest, Trigger.dev, QStash
- database-backed polling workers: pg-boss, graphile-worker
- Redis-backed: BullMQ
- platform cron + a DB-claimed work queue

For each, establish: what must be deployed, cost at MVP scale, how progress reaches the browser, how cancellation and resumption work, and what breaks at that choice.

Also establish the **hosting constraints in this environment**: the Vercel CLI is installed but its token is currently invalid; Docker is available; local Postgres port 5432 is already occupied by an unrelated container.

Feeds the batch-run semantics decision. The spec leaves the runner implementation open, so this ticket's job is to give that decision a real menu with real trade-offs.

## Answer

Findings: [`research/job-architecture.md`](../research/job-architecture.md). No winner chosen; four families are genuinely viable, differing mainly in **whose compute runs the work** and **how much queue machinery you own**.

**Hard constraint.** A single Vercel Function cannot run a whole batch: Hobby max **300s (5 min)**, Pro max **800s GA (~13 min)**, **1800s (30 min) beta** (per-function config, specific runtimes). Hobby cron is **once per day, ±59 min**; Hobby is non-commercial, so a paid product needs **Pro $20/mo**. Serverless therefore has exactly two honest shapes: chunked per-invocation work, or compute moved off Vercel.

**Shortlist and trade-offs**

- **Inngest** — orchestrator only; *your* endpoints run the work, so your host's timeout still caps each step. Free 50k executions + 5 concurrent steps. Default **4 retries per step**, cancellation **between** steps, first-class Realtime to the browser. Great if you want durability without new infra; per-row stepping blows both the free budget and the 1,000-steps/function limit.
- **Trigger.dev** — tasks run on *their* managed workers, so Vercel's timeout stops mattering. Free $5 credits / 20 concurrent; ~$18/mo at 300k per-row units, ~$1/mo batched. Real `runs.cancel`, checkpoint-resume, bulk replay, Realtime; cost is wall-clock compute.
- **QStash** — serverless push queue; compute stays yours. ~$3/mo at 300k messages, free at 3k. Flow control for Jev rate limits, DLQ. But **no run state, no progress, no true cancellation** — you own all of it in Postgres; its own pages contradict each other on retry billing (flagged).
- **pg-boss / graphile-worker** — OSS on the Postgres you already run; needs a **long-lived worker process** (rules out pure-Vercel). pg-boss: exactly-once, retryLimit 2 default, DLQ + redrive, cancel/resume APIs, no progress field. graphile: 25 attempts/~3 days default, no cancel/progress API, jobs lock ≥4h after a hard kill.
- **BullMQ** — needs a **long-lived worker** and Redis (none running locally), though a new optional Postgres backend removes Redis. Only family with built-in `job.updateProgress()` and `AbortSignal` cancellation; overkill throughput; cost ~$5–15/mo.
- **Platform cron + DB-claimed queue** — cheapest deps, most code; on Vercel it needs Pro for per-minute cron and still lives under the 300s/800s wall. Converges toward "just use pg-boss" on a container.

**MVP cost intuition:** at 5,000 rows × 3 runs/day, whether a "unit" is one row or 100 rows swings managed pricing by ~100× (Inngest $99 → $0; Trigger ~$18 → ~$1; QStash ~$3 → $0). The real Jev rate limits (ticket *The real Jev / TypeSafe evaluation API*) set the batch size, so this ties directly into *Batch-run semantics*.

**Ruled out by constraints:** whole-batch-in-one-function on Vercel; platform cron as the only trigger on Hobby; Hobby for commercial use; BullMQ-on-Redis with no Redis deployed; `work()`/standalone workers inside pure Vercel serverless. Local Postgres on **5432 is occupied** and **no Redis** is running — any Postgres-backed option needs its own container/port.

