import { Effect } from "effect"
import * as Schema from "effect/Schema"
import { SqlClient } from "effect/unstable/sql"
import { AiColumn, Correction, Dataset, DatasetRow, Label, Question, Result } from "./db/models.ts"

export type DatasetShape = Dataset
export type DatasetRowShape = DatasetRow
export type AiColumnShape = AiColumn
export type ResultShape = Result
export type CorrectionShape = Correction
export type LabelShape = Label
export type QuestionShape = Question

/**
 * Repositories. Raw SQL through Effect's Postgres layer, with every row decoded
 * through its model schema — never cast. See ADR-0001.
 *
 * Every read that returns user data is scoped by `user_id`, and every table
 * hanging off a dataset cascades from it on delete.
 */

const decodeDataset = Schema.decodeUnknownSync(Dataset)
const decodeDatasetRow = Schema.decodeUnknownSync(DatasetRow)
const decodeAiColumn = Schema.decodeUnknownSync(AiColumn)
const decodeResult = Schema.decodeUnknownSync(Result)
const decodeCorrection = Schema.decodeUnknownSync(Correction)
const decodeQuestion = Schema.decodeUnknownSync(Question)

// ── Datasets ────────────────────────────────────────────────────────────────

export interface NewDataset {
  readonly id: string
  readonly userId: string
  readonly name: string
  readonly filename: string
  readonly columns: ReadonlyArray<string>
  readonly storageKey: string | null
}

export const insertDataset = (input: NewDataset) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO dataset (id, user_id, name, filename, row_count, column_count, columns, storage_key)
      VALUES (${input.id}, ${input.userId}, ${input.name}, ${input.filename},
              0, ${input.columns.length}, ${JSON.stringify(input.columns)}, ${input.storageKey})
    `
  })

export const insertRows = (datasetId: string, rows: ReadonlyArray<Record<string, string>>) =>
  Effect.gen(function*() {
    if (rows.length === 0) return
    const sql = yield* SqlClient.SqlClient
    const payload = rows.map((data, index) => ({
      dataset_id: datasetId,
      row_index: index,
      data: JSON.stringify(data)
    }))
    yield* sql`
      INSERT INTO dataset_row ${sql.insert(payload)}
    `
    yield* sql`UPDATE dataset SET row_count = ${rows.length} WHERE id = ${datasetId}`
  })

export const listDatasets = (userId: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      SELECT id, user_id, name, filename, row_count, column_count, columns, storage_key, created_at
      FROM dataset WHERE user_id = ${userId} ORDER BY created_at DESC
    `
    return rows.map((row) => decodeDataset(row))
  })

/** Scoped by user: a dataset id alone never grants access. */
export const findDataset = (userId: string, datasetId: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      SELECT id, user_id, name, filename, row_count, column_count, columns, storage_key, created_at
      FROM dataset WHERE id = ${datasetId} AND user_id = ${userId}
    `
    return rows.length === 0 ? null : decodeDataset(rows[0]!)
  })

export const listRows = (datasetId: string, limit?: number) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const rows = limit === undefined
      ? yield* sql`
          SELECT id, dataset_id, row_index, data FROM dataset_row
          WHERE dataset_id = ${datasetId} ORDER BY row_index
        `
      : yield* sql`
          SELECT id, dataset_id, row_index, data FROM dataset_row
          WHERE dataset_id = ${datasetId} ORDER BY row_index LIMIT ${limit}
        `
    return rows.map((row) => decodeDatasetRow(row))
  })

/**
 * A spread evenly through the sheet, not the first N. Sheets are usually
 * sorted, so first-N would systematically show an unrepresentative preview.
 * See the decision "Preview semantics".
 */
export const spreadRowIndices = (rowCount: number, count: number): number[] => {
  if (rowCount <= 0) return []
  const take = Math.min(count, rowCount)
  if (take === rowCount) return Array.from({ length: rowCount }, (_, i) => i)
  const step = rowCount / take
  return Array.from({ length: take }, (_, i) => Math.min(rowCount - 1, Math.floor(i * step)))
}

export const listRowsByIndices = (datasetId: string, indices: ReadonlyArray<number>) =>
  Effect.gen(function*() {
    if (indices.length === 0) return []
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      SELECT id, dataset_id, row_index, data FROM dataset_row
      WHERE dataset_id = ${datasetId} AND row_index = ANY(${indices})
      ORDER BY row_index
    `
    return rows.map((row) => decodeDatasetRow(row))
  })

/** Hard delete. The object deletion is enqueued separately, never blocking. */
export const deleteDataset = (userId: string, datasetId: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`DELETE FROM dataset WHERE id = ${datasetId} AND user_id = ${userId}`
  })

// ── AI columns ──────────────────────────────────────────────────────────────

export interface NewAiColumn {
  readonly id: string
  readonly datasetId: string
  readonly name: string
  readonly type: "yes_no" | "category" | "score"
  readonly instruction: string
  readonly labels: ReadonlyArray<LabelShape>
  readonly needsReviewThreshold: number
}

const COLUMN_COLUMNS = `id, dataset_id, name, type, instruction, labels, ordered,
  needs_review_threshold, criteria_version, kind, composition, created_at`

export const insertAiColumn = (input: NewAiColumn) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO ai_column
        (id, dataset_id, name, type, instruction, labels, ordered, needs_review_threshold)
      VALUES (${input.id}, ${input.datasetId}, ${input.name}, ${input.type}, ${input.instruction},
              ${JSON.stringify(input.labels)}, ${input.type === "score"}, ${input.needsReviewThreshold})
    `
  })

export const listAiColumns = (datasetId: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      SELECT ${sql.unsafe(COLUMN_COLUMNS)} FROM ai_column
      WHERE dataset_id = ${datasetId} ORDER BY created_at
    `
    return rows.map((row) => decodeAiColumn(row))
  })

export const findAiColumn = (datasetId: string, id: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      SELECT ${sql.unsafe(COLUMN_COLUMNS)} FROM ai_column
      WHERE dataset_id = ${datasetId} AND id = ${id}
    `
    return rows.length === 0 ? null : decodeAiColumn(rows[0]!)
  })

export interface NewQuestion {
  readonly id: string
  readonly aiColumnId: string
  readonly key: string
  readonly type: "yes_no" | "category" | "score"
  readonly instruction: string
  readonly labels: ReadonlyArray<LabelShape>
  readonly ordinal: number
}

export const insertQuestion = (input: NewQuestion) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO question (id, ai_column_id, key, type, instruction, labels, ordinal)
      VALUES (${input.id}, ${input.aiColumnId}, ${input.key}, ${input.type},
              ${input.instruction}, ${JSON.stringify(input.labels)}, ${input.ordinal})
      ON CONFLICT (ai_column_id, key) DO UPDATE SET
        type = EXCLUDED.type,
        instruction = EXCLUDED.instruction,
        labels = EXCLUDED.labels,
        ordinal = EXCLUDED.ordinal
    `
  })

export const listQuestions = (aiColumnId: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      SELECT id, ai_column_id, key, type, instruction, labels, ordinal
      FROM question WHERE ai_column_id = ${aiColumnId} ORDER BY ordinal
    `
    return rows.map((row) => decodeQuestion(row))
  })

export const deleteAiColumn = (id: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    // Cascades to results, corrections, and batch runs.
    yield* sql`DELETE FROM ai_column WHERE id = ${id}`
  })

// ── Results ─────────────────────────────────────────────────────────────────

const RESULT_COLUMNS = `id, ai_column_id, row_id, selected_value, confidence,
  provider_confidence, sufficiency, status, criteria_version, answers, detail, provider_response, created_at, in_audit`

export interface UpsertResult {
  readonly aiColumnId: string
  readonly rowId: string
  readonly selectedValue: string | null
  readonly confidence: number | null
  readonly providerConfidence: number | null
  readonly sufficiency: number | null
  readonly status: string
  readonly criteriaVersion: number
  readonly answers: unknown
  readonly detail: unknown
  readonly providerResponse: unknown
}

/**
 * Upsert on the (AI column, row) pair: re-runs replace results rather than
 * duplicating them, which also makes the queue's at-least-once delivery safe.
 * Corrections are a separate table and are untouched by this.
 */
export const upsertResult = (input: UpsertResult) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO result
        (ai_column_id, row_id, selected_value, confidence, provider_confidence,
         sufficiency, status, criteria_version, answers, detail, provider_response)
      VALUES (${input.aiColumnId}, ${input.rowId}, ${input.selectedValue}, ${input.confidence},
              ${input.providerConfidence}, ${input.sufficiency}, ${input.status}, ${input.criteriaVersion},
              ${input.answers === null ? null : JSON.stringify(input.answers)},
              ${input.detail === null ? null : JSON.stringify(input.detail)},
              ${input.providerResponse === null ? null : JSON.stringify(input.providerResponse)})
      ON CONFLICT (ai_column_id, row_id) DO UPDATE SET
        selected_value = EXCLUDED.selected_value,
        confidence = EXCLUDED.confidence,
        provider_confidence = EXCLUDED.provider_confidence,
        sufficiency = EXCLUDED.sufficiency,
        status = EXCLUDED.status,
        criteria_version = EXCLUDED.criteria_version,
        answers = EXCLUDED.answers,
        detail = EXCLUDED.detail,
        provider_response = EXCLUDED.provider_response,
        created_at = now()
    `
  })

export const listResults = (aiColumnId: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      SELECT ${sql.unsafe(RESULT_COLUMNS)} FROM result
      WHERE ai_column_id = ${aiColumnId}
    `
    return rows.map((row) => decodeResult(row))
  })

/** Progress is derived from this, never tracked in a separate counter. */
/**
 * Draw a random audit sample from rows the user has not already reviewed.
 * Marked rather than copied, so the correction mechanism is the label.
 */
export const markAuditSample = (aiColumnId: string, count: number) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE result SET in_audit = false WHERE ai_column_id = ${aiColumnId}`
    const rows = yield* sql`
      UPDATE result SET in_audit = true
      WHERE id IN (
        SELECT r.id FROM result r
        WHERE r.ai_column_id = ${aiColumnId}
          AND r.selected_value IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM correction c
            WHERE c.ai_column_id = r.ai_column_id AND c.row_id = r.row_id
          )
        ORDER BY random() LIMIT ${count}
      )
      RETURNING id
    `
    return rows.length
  })

export const countResultsByStatus = (aiColumnId: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      SELECT status, COUNT(*)::int AS count FROM result
      WHERE ai_column_id = ${aiColumnId} GROUP BY status
    `
    const counts: Record<string, number> = {}
    for (const row of rows) counts[String(row["status"])] = Number(row["count"])
    return counts
  })

// ── Corrections ─────────────────────────────────────────────────────────────

/** Anchored to the (AI column, row) pair, so human work outlives every re-run. */
export const upsertCorrection = (input: {
  readonly aiColumnId: string
  readonly rowId: string
  readonly value: string
  readonly correctedBy: string
}) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO correction (ai_column_id, row_id, value, corrected_by)
      VALUES (${input.aiColumnId}, ${input.rowId}, ${input.value}, ${input.correctedBy})
      ON CONFLICT (ai_column_id, row_id) DO UPDATE SET
        value = EXCLUDED.value,
        corrected_by = EXCLUDED.corrected_by,
        created_at = now()
    `
  })

export const deleteCorrection = (aiColumnId: string, rowId: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`DELETE FROM correction WHERE ai_column_id = ${aiColumnId} AND row_id = ${rowId}`
  })

export const listCorrections = (aiColumnId: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      SELECT id, ai_column_id, row_id, value, corrected_by, created_at
      FROM correction WHERE ai_column_id = ${aiColumnId}
    `
    return rows.map((row) => decodeCorrection(row))
  })

// ── Batch runs ──────────────────────────────────────────────────────────────

export const insertBatchRun = (input: {
  readonly aiColumnId: string
  readonly totalRows: number
}) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      INSERT INTO batch_run (ai_column_id, status, total_rows)
      VALUES (${input.aiColumnId}, 'running', ${input.totalRows})
      RETURNING id
    `
    return String(rows[0]!["id"])
  })

export const finishBatchRun = (id: string, status: "completed" | "cancelled" | "failed") =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE batch_run SET status = ${status}, completed_at = now() WHERE id = ${id}`
  })

export const cancelBatchRun = (id: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE batch_run SET cancelled = true WHERE id = ${id}`
  })
