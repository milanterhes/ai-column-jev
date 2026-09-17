import { Effect } from "effect"
import { SqlClient, SqlError } from "effect/unstable/sql"

type Migration = Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>

/**
 * The spreadsheet domain schema.
 *
 * Ownership convention: every table that hangs off a user carries `user_id`.
 * **Owed:** the foreign key to better-auth's `user` table, plus the migration
 * ordering that makes it resolve — auth migrations must run *first*, inverting
 * the order inherited from `~/code/platform`. The FK is deliberately absent
 * here because that table does not exist yet and the migration would fail.
 * See the decision "Dataset privacy and lifecycle".
 *
 * See `.scratch/semantic-spreadsheet/spec.md` §4 for the model these encode.
 */
export const spreadsheetMigrations: Record<string, Migration> = {
  "0001_create_dataset": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE IF NOT EXISTS dataset (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id text NOT NULL,
        name text NOT NULL,
        filename text NOT NULL,
        row_count integer NOT NULL,
        column_count integer NOT NULL,
        columns jsonb NOT NULL,
        storage_key text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `
    yield* sql`CREATE INDEX IF NOT EXISTS dataset_user_idx ON dataset (user_id)`
  }),

  "0002_create_dataset_row": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE IF NOT EXISTS dataset_row (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        dataset_id uuid NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
        row_index integer NOT NULL,
        data jsonb NOT NULL
      )
    `
    yield* sql`
      CREATE UNIQUE INDEX IF NOT EXISTS dataset_row_pair_idx
      ON dataset_row (dataset_id, row_index)
    `
  }),

  "0003_create_ai_column": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE IF NOT EXISTS ai_column (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        dataset_id uuid NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
        name text NOT NULL,
        type text NOT NULL,
        instruction text NOT NULL,
        labels jsonb NOT NULL,
        ordered boolean NOT NULL DEFAULT false,
        needs_review_threshold double precision NOT NULL DEFAULT 0.8,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `
    yield* sql`CREATE INDEX IF NOT EXISTS ai_column_dataset_idx ON ai_column (dataset_id)`
  }),

  "0004_create_result": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE IF NOT EXISTS result (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ai_column_id uuid NOT NULL REFERENCES ai_column(id) ON DELETE CASCADE,
        row_id uuid NOT NULL REFERENCES dataset_row(id) ON DELETE CASCADE,
        selected_value text,
        confidence double precision,
        provider_confidence double precision,
        sufficiency double precision,
        status text NOT NULL,
        detail jsonb,
        provider_response jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `
    // Re-runs upsert on the pair, so results are never duplicated.
    yield* sql`
      CREATE UNIQUE INDEX IF NOT EXISTS result_pair_idx
      ON result (ai_column_id, row_id)
    `
    // Progress is derived by counting this index, never tracked separately.
    yield* sql`
      CREATE INDEX IF NOT EXISTS result_status_idx
      ON result (ai_column_id, status)
    `
  }),

  "0005_create_correction": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    // Anchored to the (AI column, row) PAIR, never to a result: every re-run
    // rewrites results, and a human's judgment must outlive that.
    yield* sql`
      CREATE TABLE IF NOT EXISTS correction (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ai_column_id uuid NOT NULL REFERENCES ai_column(id) ON DELETE CASCADE,
        row_id uuid NOT NULL REFERENCES dataset_row(id) ON DELETE CASCADE,
        value text NOT NULL,
        corrected_by text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `
    yield* sql`
      CREATE UNIQUE INDEX IF NOT EXISTS correction_pair_idx
      ON correction (ai_column_id, row_id)
    `
  }),

  "0006_create_batch_run": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE IF NOT EXISTS batch_run (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ai_column_id uuid NOT NULL REFERENCES ai_column(id) ON DELETE CASCADE,
        status text NOT NULL,
        total_rows integer NOT NULL,
        cancelled boolean NOT NULL DEFAULT false,
        input_tokens integer NOT NULL DEFAULT 0,
        started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      )
    `
    yield* sql`CREATE INDEX IF NOT EXISTS batch_run_column_idx ON batch_run (ai_column_id)`
  }),

  "0009_add_audit_flag": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    // Review is not a random sample — people review uncertain rows first, so
    // agreement measured on reviewed rows is biased downward. An audit draws a
    // random sample of rows the user never looked at, which is the only way to
    // state accuracy without misleading. See execution.md.
    yield* sql`
      ALTER TABLE result
      ADD COLUMN IF NOT EXISTS in_audit boolean NOT NULL DEFAULT false
    `
  }),

  "0008_add_criteria_version": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    // Criteria are mutable state: refining them is how the product improves.
    // Once they can change, results computed under different criteria are not
    // comparable, so every result must record which version produced it.
    // See corrections.md.
    yield* sql`
      ALTER TABLE ai_column
      ADD COLUMN IF NOT EXISTS criteria_version integer NOT NULL DEFAULT 1
    `
    yield* sql`
      ALTER TABLE result
      ADD COLUMN IF NOT EXISTS criteria_version integer NOT NULL DEFAULT 1
    `
  }),

  "0007_create_usage_counter": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    // Survives dataset deletion, and carries no row content — it is the meter.
    yield* sql`
      CREATE TABLE IF NOT EXISTS usage_counter (
        user_id text PRIMARY KEY,
        evaluations integer NOT NULL DEFAULT 0
      )
    `
  })
}
