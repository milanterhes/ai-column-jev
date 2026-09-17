# Architecture Decisions

ADRs for the scaffold live in this single file, numbered from 01. Read the sections touching the area you're about to work in.

## ADR-0001: Decode DB rows through the model schema; never cast a driver row to satisfy a type

- **Status**: accepted
- **Date**: 2026-09-08

### Context

Postgres returns `timestamptz` columns as JS `Date` objects, but the notes model's `select` variant types `created_at`/`updated_at` as `DateTime.Utc` (via `DateTimeUtcFromString`). `sql<Note>` is a pure type assertion — it does not decode rows. The gap was bridged in `apps/web` with `note.created_at as unknown as Date`, a cast that lies to the compiler: the type claims `Utc` while the runtime value is a `Date`.

### Decision

- The model uses `Model.DateTimeInsertFromDate` / `Model.DateTimeUpdateFromDate`, whose `select` variants (`DateTimeUtcFromDate`) accept the JS `Date` the driver returns.
- Repo functions decode each driver row with `Schema.decodeUnknownSync(Note)` before returning, so the value handed back genuinely satisfies the model's types.
- Impl layers return `created_at`/`updated_at` directly. No `as` casts reconcile a type-vs-runtime mismatch anywhere in application code.

### Sanctioned exception

`apps/web/src/api/mount.ts` casts Effect's phantom requirements (`HttpRouter.Request<"Requires", SqlClient>`, `HttpServerRequest`, router context) to `never`. These are type-vs-type declarations where the runtime is provably correct (the DB, router context, and request scope are all provided by the `ManagedRuntime`); the casts assert "satisfied at runtime," which is true. This is a framework limitation (`Layer.provide` can't strip the `HttpRouter.Request` phantom), not a lie. Documented inline.

### Consequences

- Runtime values match their declared types: `DateTime.Utc` is genuinely `Utc`, not a `Date` in disguise.
- The decode boundary lives where it belongs — at the SQL-to-domain edge in the repo — so consumers downstream never cast.
- `SchemaError` enters the repo functions' error channel (`SqlError | SchemaError`); handlers use `Effect.orDie` because a failed decode is a programming error, not a client error.
## ADR-0002: Object storage via an S3-compatible seam; presigned URLs; server HEAD-verify on confirm

- **Status**: accepted
- **Date**: 2026-09-09

### Context

The `documents` feature stores file bytes. Files are too large to live in
Postgres rows (which remain the source of truth for metadata), and proxying
bytes through the app server wastes egress and couples request handling to file
I/O. The store must work identically against AWS S3 in production and Garage
locally.

### Decision

- **A `Storage` `Context.Service` seam** in `packages/documents/src/storage/`.
  The production implementation wraps the AWS SDK v3 (`packages/documents/src/storage/s3.ts`);
  an in-memory double (`storage/test.ts`) serves tests. Application code always
  talks to `Storage`, never to AWS SDK types. Garage's requirement for
  `forcePathStyle` and its CRC32 validation of presigned PUTs are handled in the
  S3 implementation (`requestChecksumCalculation: "WHEN_REQUIRED"`), not leaked
  into domain code.
- **Presigned URLs for both directions.** `POST /me/documents` creates a
  `pending` row and returns a short-lived presigned PUT URL; the client writes
  bytes directly to storage. `GET /me/documents/:id` returns a presigned GET
  URL for `stored` documents (and a fresh PUT URL for `pending` ones, enabling
  retry without orphaning the row). Bytes never pass through the app server.
- **Server HEAD-verify on confirm.** `POST /me/documents/:id/confirm` HEADs the
  object, checks its size/content-type match the row and the size is within
  `MAX_DOCUMENT_SIZE_BYTES`, then flips `pending → stored`. Without this step
  the DB would record documents that were never actually stored or whose bytes
  differ from what the client asserted.
- **No S3 event notifications.** Garage does not implement S3's
  SNS/SQS/Lambda event path, so event-driven confirm would break the
  S3-prod/Garage-local single-code-path property. The confirm call is
  synchronous and idempotent (already-`stored` rows re-verify and return).
- **One bucket, per-user key prefix** (`user_id/<uuid>`), matching the repo's
  existing `user_id` scoping. Lazy cleanup of abandoned `pending` rows; no sweep
  yet.
- **A config-driven S3 client.** `STORAGE_*` env vars (endpoint, region, bucket,
  access key, secret, `forcePathStyle`) configure the layer, matching the app's
  `.env` conventions.

### Consequences

- Files stay in object storage; Postgres holds only metadata and the object key.
- If the client claims a size/content-type at create but uploads something else,
  confirm fails with `409 Conflict` and the row stays `pending`.
- The storage seam is testable without network: the API test drives the whole
  flow against the in-memory double, and a real-Garage round-trip test
  (`storage/s3.storage.test.ts`) runs when `STORAGE_*` env vars are set.
- Deleting a document removes both the row and the object (server calls
  `Storage.deleteObject`), so no orphaned bytes accumulate.
