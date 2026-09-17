# Adopt the scaffold as the project base

**Type:** grilling
**Status:** resolved
**Blocked by:** —

## Question

Decide the relationship between this repo and `~/code/scaffold`, what the base stack actually is, what gets stripped from the template, and what replaces the parts that go.

## Answer

**Q10 — B. Copy the scaffold's working tree into `ai-column`, no git history, fresh `git init`.** Provenance is not kept.

**Q11 — A. The scaffold's stack supersedes `handoff.md`'s stack section.** The brief's *product* content stands; its *stack* paragraph is now a historical note.

The base is a **pnpm + Turbo monorepo** (`apps/*`, `packages/*`):

- **Web:** TanStack Start 1.168.49 + TanStack Router, on **Vite 8**, **React 19.2**, via `@vitejs/plugin-react`. No Next.js, no RSC, no App Router.
- **Styling:** **Tailwind CSS v4**, CSS-first — theme tokens in `apps/web/src/styles/app.css`, no `tailwind.config.*`. shadcn/ui configured, but on **Base UI**, not Radix.
- **Server:** **Effect 4.0.0-rc.112**, APIs under `effect/unstable/*` (`http`, `httpapi`, `sql`, `schema`).
- **Database:** Postgres via **`@effect/sql-pg`** (`PgClient.layerConfig`), **no ORM, by design** — raw SQL, rows decoded through Effect `Schema` `Model.Class` (ADR-0001 forbids casting), migrations inline per package and applied by `scripts/migrate.ts`.
- **TypeScript 7.0.2**, `strict` + `exactOptionalPropertyTypes` + `erasableSyntaxOnly`.
- **Testing:** Vitest 4 with `@effect/vitest`; API suites compose the real router and sign in for real.
- **No lint/format config, no git hooks, no CI, no deploy config.**

So: ORM, auth, and job runner are **decided**; only the grid library and the hosting target remain open.

**Q12 — C. Delete `notes`, `documents`, and `notifications`, and rebuild background jobs on Effect's `PersistedQueue`.**

`notes` is a pure CRUD demo. `documents` is the only presigned-upload flow and the only emitter of `document.uploaded`; `notifications` is the only job handler — both go anyway, and the upload flow is rebuilt directly against the storage seam. The scaffold's custom outbox→jobs queue (`packages/jobs`: `outbox` + `jobs` tables, `FOR UPDATE SKIP LOCKED` claiming, 60s leases, `30s * 2^n` backoff, `dead` status, the 5s poll loop, `JobRegistry`) is replaced by **`effect/unstable/persistence/PersistedQueue`** over the existing `PgClient`.

**Q13 — better-auth 1.7.4**, following `~/code/platform`. Platform is the ideal reference: **the same TanStack Start + Effect 4.0.0-rc.112 stack**, 22 commits, well tested, with auth already bridged into Effect — a shared `packages/auth` workspace package; a raw `pg.Pool` as the adapter (better-auth's internal Kysely detects the dialect); `emailOTP` + `organization` plugins; the instance wrapped as an Effect `Context.Service` (`AuthService`); a `SessionMiddleware` that provides a `CurrentUser` service and 401s; a TanStack Start catch-all route forwarding `/api/auth/*` to `auth.handler` and everything else to the Effect `HttpApi` router; migrations via `getMigrations(...).runMigrations()` under its own `better_auth_migrations` journal, invoked from `scripts/migrate.ts` (never the CLI). Tables land in `public` with better-auth's default camelCase names: `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`.

**Q14 — A. The spec lives at `.scratch/semantic-spreadsheet/spec.md`, beside this map**, in the code repo. The scaffold's own `docs/agents/issue-tracker.md` (local markdown) and `.agents/skills/` come along, which retires the earlier "no tracker configured" gap.

### Facts established that the downstream tickets depend on

**`PersistedQueue` exists** in the installed `effect@4.0.0-rc.112` — `effect/unstable/persistence/PersistedQueue`. Not `@effect/experimental`, which is not installed. It carries `@since 4.0.0` with no deprecation warning, but lives under `unstable/*`.

- Import: `effect/unstable/persistence/PersistedQueue`. No new dependency needed.
- API is `offer(value, {id})` → dedupes on id, plus `take((value, {id, attempts}) => ...)` → completion and retry are driven by the handler's exit. There is no `complete`/`fail` pair and no capacity option.
- `layerStoreSql` sits on `SqlClient`, so the existing `PgClient` layer serves it, and it **auto-migrates its own table** (`effect_queue` by default, plus an `effect_queue_migrations` journal) on construction. Columns: `sequence, id, queue_name, element TEXT, completed, attempts, last_failure, acquired_at, acquired_by, created_at, updated_at`; claiming is `FOR UPDATE SKIP LOCKED`; leases refresh every 30s and expire after 2min; default poll interval 1s.
- Worker pattern: `queue.take(handler).pipe(Effect.forever)`, optionally replicated — see `effect/unstable/workflow/DurableQueue.makeWorker`.
- **Semantics to design around:** at-least-once with enqueue-time dedup only, so **processing is not idempotent**. There is **no exponential backoff** — failures re-enter immediately up to `maxAttempts` (default 10). There is **no `run_after`**, so no scheduling. The SQL store has **no dead-letter list and no retry-exhausted equivalent** — exhausted rows stay in place, visible only as `completed = false` with `attempts >= maxAttempts`. Payloads are schema-encoded to `TEXT`, not `jsonb`.

### Consequences recorded

- The scaffold's `packages/jobs` and the worker's claim loop are superseded. `JobRegistry`'s type→handler idea survives; `retry-dead-job.ts` does not.
- The six test suites that imported `notesMigrations` purely as a generic migration fixture need substituting.
- The storage seam exposes only presign/HEAD/delete — **no server-side object read** — so CSV parsing has to be built against it.
- `handoff.md`'s "Prisma or Drizzle", "Next.js", and "hosted auth vendor" are all superseded.
