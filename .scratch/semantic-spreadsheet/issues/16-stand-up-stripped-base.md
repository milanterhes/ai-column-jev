# Stand up the stripped base

**Type:** task
**Status:** open
**Blocked by:** —
**Context:** `issues/15-adopt-scaffold-base.md`

## Question

Not a decision — this is the one execution step this effort carries inside the map (see the map's Notes). Reduce `~/code/scaffold` to a clean base for this product, in this repo.

The work:

1. Copy the scaffold's working tree into `ai-column` **without its git history**; `git init` fresh.
2. Delete `packages/notes`, `packages/documents`, `packages/notifications` and their web routes, API modules, components, tests, and workspace dependencies.

   **Flagged, needs a call before doing it:** `packages/documents` also contains the entire S3/Garage **storage seam** (`storage/storage.ts`, `storage/s3.ts`, the presigned PUT/HEAD/delete flow, per-user key prefixes). Deleting the package deletes upload capability outright, and the brief requires CSV upload. The likely move is to lift the seam into its own `packages/storage` before deleting `documents` — and while lifting it, note the seam has **no server-side object read**, which sheet parsing will need.
3. Repoint the six test suites that import `notesMigrations` as a generic migration fixture.
4. Remove the demo wiring: `scripts/migrate.ts`, `apps/web/src/api/mount.ts`, `web.api.ts`, the landing page's `notes` link and "what's here" list, `CONTEXT.md`'s `Note` glossary entry.
5. Replace `packages/jobs` and the worker's claim loop with `PersistedQueue` over the existing `PgClient` — `layerStoreSql`, one queue per job type or a registry-dispatched queue, worker as `queue.take(handler).pipe(Effect.forever)`.
6. Stand up `packages/auth` on better-auth 1.7.4 per `~/code/platform`'s conventions: shared package with server/client/api/migrate subpaths, raw `pg.Pool`, `emailOTP` + `organization`, `AuthService` as an Effect service, `SessionMiddleware` providing `CurrentUser`, the `/api/auth/*` catch-all, and migration via `getMigrations` from `scripts/migrate.ts`.
7. Provision **Redis** alongside Postgres — required by **Batch-run semantics** for `RateLimiter` state, whose only non-memory store is Redis.
8. Apply the privacy constraints from **Dataset privacy and lifecycle**: lower `MAX_DOCUMENT_SIZE_BYTES` to the 50 MB cap; add a **server-side object read** to the storage seam (parsing currently has no way to reach the bytes); and run **auth migrations before app migrations**, so the foreign key to better-auth's `user` table resolves.
9. Confirm the stripped base builds, typechecks, and tests green.

**Not in this ticket:** any product feature. No datasets, no CSV parsing, no AI columns. This ends at a running, tested, empty base.

**Note for the eventual build:** this will likely need its own ticket breakdown when it is picked up; treat the list above as the shape, not the final slicing.

## Answer

<!-- recorded on resolution -->
