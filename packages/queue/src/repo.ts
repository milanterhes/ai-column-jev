import { Effect } from "effect"
import * as Schema from "effect/Schema"
import { SqlClient } from "effect/unstable/sql"

/**
 * Queue-owned repositories.
 *
 * The AI column is read here rather than through `@app/spreadsheet/repo`
 * because that repository decodes labels through a `{name, description}` model,
 * which drops the structured criteria (`what`, `notFor`, `examples`, `signals`)
 * Jev needs. The handler must see the same label shape the user authored.
 */

const LabelSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  what: Schema.optional(Schema.String),
  notFor: Schema.optional(Schema.String),
  examples: Schema.optional(Schema.Array(Schema.String)),
  signals: Schema.optional(Schema.Array(Schema.String))
})

const WorkColumnSchema = Schema.Struct({
  id: Schema.String,
  dataset_id: Schema.String,
  type: Schema.Literals(["yes_no", "category", "score"]),
  instruction: Schema.String,
  labels: Schema.Array(LabelSchema),
  criteria_version: Schema.Number,
  needs_review_threshold: Schema.Number
})
export type WorkColumn = Schema.Schema.Type<typeof WorkColumnSchema>

const WorkRowSchema = Schema.Struct({
  id: Schema.String,
  dataset_id: Schema.String,
  row_index: Schema.Number,
  data: Schema.Record(Schema.String, Schema.Unknown)
})
export type WorkRow = Schema.Schema.Type<typeof WorkRowSchema>

const RunSchema = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["running", "completed", "cancelled", "failed"]),
  cancelled: Schema.Boolean
})
export type Run = Schema.Schema.Type<typeof RunSchema>

const RunningRunSchema = Schema.Struct({
  id: Schema.String,
  ai_column_id: Schema.String,
  total_rows: Schema.Number,
  cancelled: Schema.Boolean
})
export type RunningRun = Schema.Schema.Type<typeof RunningRunSchema>

const decodeColumn = Schema.decodeUnknownSync(WorkColumnSchema)
const decodeRow = Schema.decodeUnknownSync(WorkRowSchema)
const decodeRun = Schema.decodeUnknownSync(RunSchema)
const decodeRunningRun = Schema.decodeUnknownSync(RunningRunSchema)

export const findWorkColumn = (id: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      SELECT id, dataset_id, type, instruction, labels, criteria_version, needs_review_threshold
      FROM ai_column WHERE id = ${id}
    `
    return rows.length === 0 ? null : decodeColumn(rows[0]!)
  })

export const findWorkRow = (id: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      SELECT id, dataset_id, row_index, data FROM dataset_row WHERE id = ${id}
    `
    return rows.length === 0 ? null : decodeRow(rows[0]!)
  })

export const findRun = (id: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      SELECT id, status, cancelled FROM batch_run WHERE id = ${id}
    `
    return rows.length === 0 ? null : decodeRun(rows[0]!)
  })

/**
 * `failed` is reserved for the run being unable to proceed at all — the column
 * was deleted mid-flight. A failed *subset* never fails the run.
 */
export const markRunFailed = (id: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      UPDATE batch_run SET status = 'failed', completed_at = now()
      WHERE id = ${id} AND status = 'running'
    `
  })

export const listRunningRuns = (limit: number, startedBefore: Date) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      SELECT id, ai_column_id, total_rows, cancelled FROM batch_run
      WHERE status = 'running' AND started_at < ${startedBefore}
      ORDER BY started_at LIMIT ${limit}
    `
    return rows.map((row) => decodeRunningRun(row))
  })

/**
 * Work still outstanding for a run, counted from the queue rather than a
 * counter. `attempts < maxAttempts` matches the scheduler's notion of active:
 * an exhausted item stays in place with no dead-letter list, and counts as
 * terminal for the run.
 */
export const countPendingItemsForRun = (tableName: string, maxAttempts: number, runId: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const table = sql(tableName)
    const rows = yield* sql`
      SELECT count(*)::int AS count FROM ${table}
      WHERE completed = FALSE
        AND attempts < ${maxAttempts}
        AND element::jsonb->>'runId' = ${runId}
    `
    return Number(rows[0]!["count"])
  })
