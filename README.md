# AI Column

A self-serve web app where you upload a CSV, add **AI columns** that need
human-like judgment, inspect the results with their confidence, review the rows
the model is unsure about, and export the enriched CSV.

The thought it is built around is *"I wish this spreadsheet had one more column,
but a human would have to fill it in."* The product turns that into a **+ AI
column** button.

Per-row judgment is done by **Jev** (TypeSafe AI's System One model), which
returns typed probabilistic decisions — a category, a score, a yes/no, each with
a confidence and an explicit `unable-to-determine`. A general-purpose LLM is
used **only** to help phrase a rule before any evaluation happens. It never
evaluates a row.

## The loop

1. **Upload** a CSV. Headers become the spreadsheet; rows are kept in Postgres.
2. **Add an AI column** — name it, pick a type (`yes_no`, `category`, `score`),
   and write the instruction the way you'd explain it to a careful colleague.
   **Preview** it against a sample before committing.
3. **Run it** over every row. The run goes to a background queue and returns
   immediately; results stream in.
4. **Review** the rows whose confidence fell below the column's threshold —
   correct them in place.
5. **Report** on the column: agreement from your corrections, the confidence
   distribution, and a random audit — the only number nobody selected for.
6. **Export** the enriched CSV, with each AI column as its own column.

Each column also carries up to **five extra questions** asked in the *same*
provider request as the column's own question — so a second judgment on the same
row costs a fraction more rather than doubling the run. They appear in the row
detail.

## Quick start

```bash
pnpm install
cp .env.example .env      # then add your JEV_KEY (a TypeSafe API key)

pnpm demo                 # infra up, migrations applied, app started
```

`pnpm demo` is safe to re-run. It brings up Postgres and Redis, waits for
Postgres, applies migrations, and starts the web app and the evaluation worker.

Open <http://localhost:3000>, sign in with **any** email address — the six-digit
code is printed in the terminal you ran the command in — and click **"Try it
with sample data"** for a 35-ticket support dataset.

## Repository layout

```
apps/
  web/              TanStack Start + React 19 SPA. The Effect HttpApi is mounted
                    at /api/* inside the same server process.
    src/api/        composition root, hand-rolled router, typed fetch client
    src/components/ the spreadsheet grid, add-column drawer, review workflow
    src/routes/     datasets (upload + grid), review, report, signin
  worker/           the queue consumer: claims work, calls Jev, writes results
packages/
  spreadsheet/      the domain. Dataset, dataset_row, ai_column, result,
                    correction tables; CSV parse and export; column reports
                    and the random audit.
  evaluate/         the Jev adapter. Request building, response parsing, the
                    Noul confidence rule, per-type thresholds, row batching,
                    and an adaptive Redis-backed rate limiter.
  queue/            persisted work queue: per-user per-class fairness, reserved
                    interactive slots, cancel-first handling, retryable vs
                    terminal failures.
  auth/             better-auth wiring — sessions, email codes, OAuth.
  core/             the shared Postgres client (PgLive) and test-database helpers.
scripts/
  demo.sh           one command to run everything
  migrate.ts        applies every package's migrations, auth first
docs/               architecture decisions (ADRs) and agent-skill docs
```

## How evaluation actually works

Three decisions are worth knowing before you read the code.

**Confidence is not one number.** Jev's confidence means different things per
output type, so the threshold does too. `yes_no` columns are asked through
Jev's Noul mode, whose confidence is the probability of the answer it selected —
they get a **0.6** threshold. `category` and `score` columns get the winning
label's share, with a **0.8** threshold (`defaultThresholdFor` in
`packages/evaluate/src/core.ts`). A single threshold would either drown you in
review for binary columns or hide real uncertainty in category ones.

**Rows are batched, not sent one at a time.** Batching 50 rows into one request
measured ~1.8× cheaper and ~40× faster than 50 separate requests. Bulk runs are
chunked at `BATCH_CHUNK_SIZE = 100`. The ceiling is request *byte size*, not a
token count — around 240 rows of the sample data, and the provider fails the
whole request rather than part of it.

**Rules are stated structurally.** A label carries `what` it means, what it is
`notFor`, and worked `examples`, and the row state is decomposed rather than
dumped as one blob. Sending Jev one flat blob of criteria left one in four
decisions unanswerable; decomposing it and adding the `notFor` branch cut that
to one in fourteen.

## Accuracy

An AI column is only useful if you can see how wrong it is. The **Report** tab
shows three things: agreement between the model and your corrections, the
distribution of confidence across rows, and a **random 25-row audit** — sampled
without regard to confidence, and labelled in the UI as the only unbiased number
on the page, because the other two are both selected by the model's own
confidence.

Corrections are the signal that matters: they are stored per result, they
override the model's value everywhere (grid, review, export), and they are what
agreement is computed from.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm demo` | Infra up → migrate → run the app and worker (the whole thing) |
| `pnpm dev` | Run the web app and worker only (Turbo, `:3000`) |
| `pnpm build` | Type-check and build every package |
| `pnpm test` | Run every package's Vitest suite |
| `pnpm lint` | `tsc --noEmit` across the repo |
| `pnpm migrate` | Apply every package's migrations, auth schema first |
| `pnpm --filter <pkg> <task>` | Target a single package |

## Environment variables

`.env.example` is the template. If `.env` is missing, `pnpm demo` creates it and stops,
so you can add `JEV_KEY` before it runs for real.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres. Note the host port is **5433** |
| `JEV_KEY` | yes | TypeSafe API key. Everything else is pre-filled |
| `REDIS_URL` | yes | Rate-limiter state. Provisioned by `docker compose` |
| `BETTER_AUTH_SECRET` | yes | Session signing |
| `BETTER_AUTH_URL` | yes | Base URL for auth callbacks |
| `JEV_BASE_URL` / `JEV_MODEL` | no | Default to `https://api.typesafe.ai` / `jev-latest` |
| `OPENAI_API_KEY` | no | Rule clarification only. Unset disables "Improve this"; the core loop never needs it |
| `MAX_DATASET_SIZE_BYTES` | no | Upload cap, 50 MB |
| `GOOGLE_*` | no | Optional OAuth provider |

`STORAGE_*` and `pnpm setup:object-storage` configure an S3-compatible Garage
bucket, but **nothing writes to it today** — `dataset.storage_key` is always
null and rows live in Postgres. Treat that command as preparation, not setup.

## Testing

Two suites run today: `packages/evaluate/src/core.test.ts` covers request
building, response parsing and answer extraction; `packages/queue/src/scheduler.test.ts`
covers the claim loop. `packages/core/src/test-utils.ts` provides a dedicated
test database (created on demand, migrated in `beforeAll`) for the DB-backed
domain suites, which are not yet written — that is the largest testing gap in
the repo.

## Status

Built and working end to end: upload → column → preview → queued run → review →
report → export, with extra questions per column and an adaptive rate limiter.

Not built: composite columns that compose one value from several answers, saved
and re-applied rules, speculative column suggestions, escalation and entity
resolution, and CSV connectors. There is also **no foreign key** from `dataset`
to better-auth's `user` table — ownership is enforced in every query, but the
constraint is absent.

`.scratch/semantic-spreadsheet/` holds the specification, the plan, and the
measured evidence behind the numbers above.

## Docs & conventions

- [`docs/architecture-decisions.md`](docs/architecture-decisions.md) — ADRs.
  Read the ones touching your area before you change it.
- [`AGENTS.md`](AGENTS.md) — repository guidelines: Effect patterns, commands,
  the agent-skill framework. **Its package list predates this product and still
  describes the scaffold it was copied from.**
- **Postgres is the source of truth.** Raw SQL through Effect's Postgres layer,
  no ORM. Migrations are Effect programs, owned by the package whose schema they
  describe.
- **Never cast to reconcile a type-vs-runtime mismatch.** Rows are decoded
  through the model's `Schema`; if a value's runtime shape differs from its
  type, fix the boundary. The one sanctioned exception is documented inline in
  `apps/web/src/api/mount.ts`.
- **No comments unless they carry information the code does not.**

## Provenance

Copied from `~/code/scaffold` without git history and repurposed. Not every
inherited file has kept up: `CONTEXT.md`, `AGENTS.md`, and the ADR file still
describe the scaffold's `notes` and `documents` demo domains, which no longer
exist.
