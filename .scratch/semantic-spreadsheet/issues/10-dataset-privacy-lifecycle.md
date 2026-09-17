# Dataset privacy and lifecycle

**Type:** grilling
**Status:** resolved
**Assignee:** milanterhes
**Blocked by:** —
**Context:** `issues/15-adopt-scaffold-base.md`, `research/hosted-auth.md`; inherits from **One result shape across the three column types** — row data lives in Postgres as `jsonb` *and* the original uploaded file is archived in object storage, so deletion must cover both; and from **Corrections layered over model output** — corrections cascade with the dataset like every other derived row

## Question

Decide the privacy and lifecycle rules the spec must state, treating uploaded datasets as private user data.

Settle:

- **Isolation.** What guarantees that one user can never read another's dataset, rows, or results. **better-auth owns the `user` and `session` tables** (default camelCase columns, in `public`), so the app's ownership column is a string user id with no database foreign key — decide whether to add the FK or enforce it in application code, and how it becomes an ownership column on Dataset and every derived table. The earlier research conclusion stands: isolation never keys off email or vendor metadata.
- **Storage.** The upload path is presigned PUT straight to S3-compatible storage with a per-user key prefix; decide whether keys encode the user, and what happens to objects when a dataset is deleted. Note the seam has no server-side object read today, so parsing needs a read path — decide whether row data is parsed from the stream or downloaded.
- **Ingest limits.** Maximum file size, maximum row count, permitted row width, and what the user is told when they exceed them.
- **Validation.** File-type and MIME checks for CSV, what "safe parsing" means here, and re-encoding or rejecting non-UTF-8 input.
- **What leaves the machine.** Which row fields are sent to Jev and which are not; whether the user is told this; whether the whole row or only the relevant columns are sent.
- **Logging.** The rule that row content never appears in application logs or error reports, and what is logged instead.
- **Deletion.** What "delete dataset" removes, whether it is immediate or delayed, and whether batch-run and usage records survive it.
- **Retention.** Whether anything is retained after deletion, and for how long.

## Answer

**Isolation: a real foreign key, plus session-scoped queries.** Every table we own that hangs off a user — Dataset, and through it rows, AI columns, results, corrections, batch runs — carries an ownership column with a **foreign key to better-auth's `user.id`**, and every query is scoped by the session user. The FK makes orphaned rows impossible and puts ownership in the schema where it is visible, rather than relying on whoever writes the next query remembering a `WHERE`. *(Rejected: app-enforced scoping alone — one forgotten clause from a cross-tenant leak of private spreadsheets. Rejected for now: row-level security, which is genuinely stronger but needs the user carried through every transaction as a session variable; that is the hardening step once the slice works.)*

> **Landmine this creates.** In `~/code/platform`, `runAuthMigrations` runs **last** in `scripts/migrate.ts`. A foreign key to `user` means **auth migrations must run first**. One line, in the wrong order, in the base we are copying.

**Storage: keys encode ownership; the two deletions are split.** Object keys are `<userId>/<datasetId>/original.csv` — which matches what the scaffold already does, and means the key itself corroborates ownership, which is what makes a presigned URL safe to hand out. On delete, the **database records are removed immediately** and the dataset is tombstoned so it stops being listed; the **object deletion is enqueued and retried**. Object stores fail transiently, and a user who clicks delete must never be told to try again because S3 was slow.

> **Required addition.** The storage seam as inherited exposes only presign/HEAD/delete — there is **no server-side object read**, so parsing has no way to reach the bytes. The seam must gain a read path.

**Ingest limits: 50 MB, 100,000 rows, 256 columns.** 50 MB of CSV is roughly half a million rows, so the row cap bites first, and it bites at a number that keeps a full run's cost and duration legible. The inherited default is **5 GiB**, which must be lowered. Exceeding a limit produces a message naming **the limit and the actual value**, never a generic "upload failed".

**Encoding: detect and transcode, do not reject.** Decode as UTF-8; if that fails, transcode from **Windows-1252** and **tell the user what was assumed**. Excel on Windows produces Windows-1252 CSV, which is a very common path, and rejecting invalid UTF-8 would fail a large share of ordinary spreadsheets on the product's very first step. Reject only what genuinely cannot be decoded. Never silently mangle an accent into a question mark.

**What leaves the machine: the whole row, disclosed.** The row is sent to Jev as its `state`. The instruction may reference any column, so any narrower rule is a guess that can silently change a judgment, and a column-picker is a real feature with real UI and schema behind it. The user is told plainly that the row's values go to the evaluation provider.

> **Flagged improvement:** letting the user choose **which columns an AI column reads** would cut both cost and data exposure, and is the natural next step. It changes the AI column's definition to carry a source-column list — worth doing, not in the slice.

**Logging: identifiers and metrics only.** Dataset id, row count, status, latency, token usage, error class. **Never cell values, never the instruction text.** Row content must not reach application logs or error trackers even on failure — which means provider errors are **translated before being logged**, not dumped raw.

**Deletion: hard, immediate, and complete.** "Delete dataset" removes the dataset, its rows, its AI columns, its results, its corrections, and its batch runs from the database, and enqueues the archived object for deletion. **The only thing that survives is an aggregate usage count carrying no content** — it holds no row data, and it is the meter that usage accounting exists to keep. *(Rejected: destroying the usage count too. Rejected: soft delete with a grace period, which sounds friendlier but means a deleted dataset is still stored somewhere — precisely what deletion is meant to promise — and adds a purge job the slice doesn't need.)*

**Retention: nothing else, indefinitely or otherwise.** No grace period, no archive, no shadow copy.

### Handed to other tickets

- **Stand up the stripped base** must: lower `MAX_DOCUMENT_SIZE_BYTES` to the 50 MB cap; add a **server-side object read** to the storage seam; run auth migrations **before** app migrations; and provision Redis (already recorded).
- **The evaluation-service boundary** inherits: Jev's `state` is the **whole row**, rendered by the adapter.
- **Table behaviour in the slice** inherits: the delete action and its confirmation belong to the dataset, not the grid.
