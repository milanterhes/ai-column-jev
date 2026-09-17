# Repository Guidelines

## Project shape

- pnpm monorepo. `apps/web` is a full-stack TanStack Start app (React + Effect HTTP API mounted in-process); `packages/auth` is a cookie-session email-code auth package (`auth-postgres` storage, `auth-resend` mailer); `packages/core` holds shared Effect services (`PgLive`, test utilities); `packages/notes` is a demo domain (Model, Postgres repo, HTTP API); `packages/documents` is an object-storage demo domain (Model, Postgres repo, a `Storage` seam over S3/Garage, HTTP API).
- Postgres is the source of truth. No ORM — raw SQL via Effect's Postgres layer. Model types come from `effect/Schema` (`Model.Class` in `packages/notes`).
- Object storage is S3-compatible (`Storage` seam in `packages/documents/src/storage/`): AWS S3 in production, Garage locally (`docker compose up -d` provides it on :3900 with a provisioned bucket). The app only ever talks to the `Storage` `Context.Service`, never AWS SDK types directly.
- Design intent lives in `docs/`: `architecture-decisions.md` (ADRs in one file), plus `docs/agents/` for the skill framework.

## Effect patterns

This repo is a scaffold built to demonstrate idiomatic Effect 4 usage. Prefer the patterns already established in the code over new shapes:

- **Repos decode rows through the model schema** (`Schema.decodeUnknownSync(Note)`), never via type-cast (`as`). A raw driver row is a JS `Date`, not a `Utc`; the model's `select` variant converts it. See ADR-0001.
- Service interfaces and impls live in the same file; layers are exported alongside.
- `Effect.fnUntraced` for named effects so traces read well.

## Build, test, and run

- Local Postgres: `docker compose up -d` (a shared `jobdetective-postgres-1` container is also used; port 5432). This also starts Garage (S3-compatible object storage) on :3900 with bucket `scaffold-documents`.
- Migrations: `pnpm migrate` (creates the `scaffold` DB; test DB `scaffold_test` is created by the test harness). First-time object-storage setup: `pnpm setup:object-storage` (configures CORS on the local Garage bucket; Garage auto-provisions the bucket/keys but not CORS, and only the browser upload path needs it).
- Dev server: `cd apps/web && npx vite dev` (API is mounted at `/api` inside the Start server).
- Tests: `pnpm test` (vitest), `pnpm lint`, `pnpm build`. The real-Garage storage round-trip test (`packages/documents/src/storage/s3.storage.test.ts`) runs when `STORAGE_*` env vars are set and skips otherwise; set them from `.env` to exercise it.

## Conventions

- Do not add comments unless they carry information the code does not.
- Never cast to reconcile a type-vs-runtime mismatch (`as unknown as Date`). If a value's runtime shape differs from its type, fix the boundary (decode through a Schema) rather than lying to the compiler. The one sanctioned exception: bridging Effect's phantom requirements in `apps/web/src/api/mount.ts`, documented inline.

## Secrets

- Secrets live in untracked `.env` (gitignored); `.env.example` is the tracked template. Never commit keys or database URIs.

## Agent skills

### Issue tracker

Local markdown under `.scratch/<feature>/` (spec + numbered issue files). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the root; ADRs in `docs/architecture-decisions.md`. See `docs/agents/domain.md`.