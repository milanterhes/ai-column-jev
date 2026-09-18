# Repository Guidelines

## Project shape

- pnpm + Turbo monorepo (`apps/*`, `packages/*`). The product is **AI Column**: a
  spreadsheet you upload a CSV into, add judgment columns to, review, and export.
- `apps/web` — TanStack Start + React 19. It mounts a **hand-rolled API router**
  (not Effect `HttpApi`) at `/api/*` inside the same server process, and is the
  composition root. `apps/worker` — the queue consumer that calls Jev.
- `packages/spreadsheet` — the domain: `dataset`, `dataset_row`, `ai_column`,
  `question`, `result`, `correction`, `batch_run`, `usage_counter`; CSV parse and
  export; column reports and the random audit.
- `packages/evaluate` — the Jev/TypeSafe adapter: request building, response
  parsing, the Noul confidence rule, per-type thresholds, row batching, and an
  adaptive Redis-backed rate limiter.
- `packages/queue` — the persisted work queue: per-user per-class fairness,
  reserved interactive slots, cancel-first handling, retryable vs terminal
  failures.
- `packages/auth` — **better-auth 1.7.4**, not a bespoke Effect auth package. It
  owns `user`/`session` in the `public` schema. `packages/core` — shared
  `PgLive` client and test-database helpers.
- **Postgres is the source of truth.** No ORM: raw SQL through Effect's Postgres
  layer, rows decoded through an Effect `Schema`. There is no `notes` or
  `documents` package — those belonged to the scaffold this repo was copied from.
- Design intent lives in `docs/` (`architecture-decisions.md`, `docs/agents/`) and
  `.scratch/<feature>/` (spec, plan, and the measured evidence behind the tuning).

## Effect patterns

Effect 4 (`4.0.0-rc.112`, APIs under `effect/unstable/*`). Prefer what the code
already does over new shapes:

- **Models are plain `Schema.Struct`** in `packages/*/src/db/models.ts` — not
  `Model.Class`, and with no `select` variant. Postgres returns real numbers for
  `double precision` and real `Date`s for `timestamptz`; the schemas say so
  directly.
- **Repos decode every driver row through its schema**
  (`Schema.decodeUnknownSync(Dataset)`), never via a cast. If a value's runtime
  shape and its type disagree, fix the boundary. The one sanctioned exception is
  bridging Effect's phantom layer requirements in `apps/web/src/api/mount.ts`,
  documented inline.
- Service interfaces and their implementations live in the same file, with the
  `...Live` layer exported alongside. Layers are assembled once in
  `apps/web/src/api/mount.ts` (web) and `apps/worker/src/index.ts` (worker).
- There is **no `Effect.fnUntraced` convention here** — repo and service functions
  are plain `Effect.fnUntraced`-free effectful arrows.
- This Effect RC has no `catchAll`, `zipRight`, or `catchAllCause`. Use `catchIf`,
  `andThen`, `catchCause`, `Effect.retry({ schedule, times })`, `Effect.catchTag`.

## Build, test, and run

- **`pnpm demo`** is the one command: Docker up (Postgres + Redis), wait, migrate,
  then the web app and worker. It refuses to start without `JEV_KEY`, and creates
  `.env` from `.env.example` and stops if `JEV_KEY` is empty.
- Postgres is on **5433** (not 5432), database `ai_column`. Redis on 6379. The
  test database is `scaffold_test`, created on demand by
  `packages/core/src/test-utils.ts`.
- **Migrations run auth first** (`scripts/migrate.ts`), because better-auth owns
  `user` and anything referencing it must come after. Auth sets up
  `auth.*`/`public.*` before the spreadsheet's migrations.
- Dev server: `pnpm dev` (Turbo, web + worker, `:3000`). Tests: `pnpm test`
  (Vitest), `pnpm lint` and `pnpm build` (both `tsc --noEmit` per package).
- **Garage and `pnpm setup:object-storage` exist but nothing writes to S3.**
  `dataset.storage_key` is always `null` and rows live in Postgres. Do not assume
  the object-storage seam is live.

## Gotchas

- `erasableSyntaxOnly` — **no constructor parameter properties**.
- `exactOptionalPropertyTypes` — `foo?: string` is not `foo?: string | undefined`.
  Optional fields that may be explicitly `undefined` must say so.
- `noUnusedLocals` / `noUnusedParameters` are on, and relative imports need an
  explicit `.ts` / `.tsx` extension (`rewriteRelativeImportExtensions`).
- `packages/evaluate/src/core.ts` is the tuning surface. The numbers in it
  (`SUFFICIENCY_MIN`, `defaultThresholdFor`, `BATCH_CHUNK_SIZE`) were measured, not
  guessed — read the comment before changing one, and re-measure if you do.
- Jev's request contract is irregular: `choice` takes `criteria` as a
  label→description **map**, `score` as an **ordered array**. Sending the wrong
  shape is a 422, not a silent degradation.
- Batch requests fail **all-or-nothing**, and the ceiling is request **byte size**
  rather than a token count.

## Conventions

- Do not add comments unless they carry information the code does not. Migration
  files and tuning constants are where the non-obvious rationale belongs.
- Never cast to reconcile a type-vs-runtime mismatch. Decode through a Schema at
  the boundary instead.

## Secrets

- Secrets live in untracked `.env` (gitignored); `.env.example` is the tracked
  template. Never commit keys or database URIs. `JEV_KEY` is the only value the
  demo cannot pre-fill.

## Agent skills

### Issue tracker

Local markdown under `.scratch/<feature>/` (spec + numbered issue files). See
`docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the root; ADRs in
`docs/architecture-decisions.md`. See `docs/agents/domain.md`.
