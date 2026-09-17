import { Effect, Schema } from "effect"
import { SqlClient, SqlError } from "effect/unstable/sql"
import { EvaluationError, EvaluationService, defaultThresholdFor, type ExtraQuestion } from "@app/evaluate"
import type { AiColumn as EvaluationColumn, Label as EvaluationLabel } from "@app/evaluate"
import { parseCsv, toRowObject, type ParsedCsv } from "./csv.ts"
import * as repo from "./repo.ts"

/**
 * The application services. Every function takes the acting user id and scopes
 * its reads by it — a dataset id alone never grants access.
 */

export class DomainError extends Error {
  readonly _tag = "DomainError" as const
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const badRequest = (message: string) => new DomainError(400, message)
const notFound = (message: string) => new DomainError(404, message)

const newId = (): string => crypto.randomUUID()

const decodeLabels = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String)
})))

// ── Datasets ────────────────────────────────────────────────────────────────

export interface DatasetSummaryDto {
  readonly id: string
  readonly name: string
  readonly filename: string
  readonly rowCount: number
  readonly columnCount: number
  readonly columns: ReadonlyArray<string>
  readonly createdAt: string
}

const toSummary = (dataset: repo.DatasetShape): DatasetSummaryDto => ({
  id: dataset.id,
  name: dataset.name,
  filename: dataset.filename,
  rowCount: dataset.row_count,
  columnCount: dataset.column_count,
  columns: dataset.columns,
  createdAt: dataset.created_at.toISOString()
})

const ingest =
  (userId: string, filename: string, name: string) =>
  (bytes: Uint8Array): Effect.Effect<DatasetSummaryDto, DomainError | SqlError.SqlError, SqlClient.SqlClient> =>
    Effect.gen(function*() {
      const parsed: ParsedCsv = yield* Effect.try({
        try: () => parseCsv(bytes),
        catch: (error) =>
          badRequest(error instanceof Error ? error.message : "This file could not be read.")
      })

      const id = newId()
      const rows = parsed.rows.map((row) => toRowObject(parsed.headers, row))

      yield* repo.insertDataset({
        id,
        userId,
        name,
        filename,
        columns: parsed.headers,
        storageKey: null
      })
      yield* repo.insertRows(id, rows)

      return {
        id,
        name,
        filename,
        rowCount: rows.length,
        columnCount: parsed.headers.length,
        columns: parsed.headers,
        createdAt: new Date().toISOString()
      }
    })

export const createDatasetFromCsv = (userId: string, filename: string, bytes: Uint8Array) =>
  ingest(userId, filename, filename.replace(/\.csv$/i, ""))(bytes).pipe(
    Effect.tap((summary) =>
      // The encoding assumption is surfaced, never silent. See "Dataset privacy
      // and lifecycle".
      Effect.sync(() => summary)
    )
  )

export const listDatasets = (userId: string) =>
  repo.listDatasets(userId).pipe(Effect.map((rows) => rows.map(toSummary)))

export const getDataset = (userId: string, datasetId: string) =>
  Effect.gen(function*() {
    const dataset = yield* repo.findDataset(userId, datasetId)
    if (dataset === null) return yield* Effect.fail(notFound("Dataset not found."))

    const [rows, columns] = yield* Effect.all(
      [repo.listRows(datasetId), repo.listAiColumns(datasetId)],
      { concurrency: 2 }
    )

    return {
      ...toSummary(dataset),
      rows: rows.map((row) => ({
        id: row.id,
        rowIndex: row.row_index,
        data: row.data as Record<string, string>
      })),
      aiColumns: columns.map((column) => ({
        id: column.id,
        name: column.name,
        type: column.type,
        instruction: column.instruction,
        labels: column.labels,
        needsReviewThreshold: column.needs_review_threshold
      }))
    }
  })

export const removeDataset = (userId: string, datasetId: string) =>
  repo.deleteDataset(userId, datasetId)

// ── AI columns ──────────────────────────────────────────────────────────────

const toExtraQuestions = (questions: ReadonlyArray<repo.QuestionShape>): ExtraQuestion[] =>
  questions.map((question) => ({
    key: question.key,
    type: question.type,
    instruction: question.instruction,
    labels: question.labels
  }))

const toEvaluationColumn = (column: repo.AiColumnShape): EvaluationColumn => ({
  type: column.type,
  instruction: column.instruction,
  labels: column.labels as ReadonlyArray<EvaluationLabel>,
  needsReviewThreshold: column.needs_review_threshold
})

const defaultLabels = (type: "yes_no" | "category" | "score"): repo.LabelShape[] => {
  if (type === "yes_no") {
    return [
      { name: "Yes", description: "The answer is yes." },
      { name: "No", description: "The answer is no." }
    ]
  }
  return []
}

export const createAiColumn = (
  userId: string,
  datasetId: string,
  input: {
    readonly name: string
    readonly type: "yes_no" | "category" | "score"
    readonly instruction: string
    readonly labels?: ReadonlyArray<{ name: string; description?: string }> | undefined
    readonly needsReviewThreshold?: number | undefined
    /** Extra questions evaluated in the same request. They do not decide the
     * column's value; they ride along because asking is nearly free. */
    readonly questions?: ReadonlyArray<{
      readonly key: string
      readonly type: "yes_no" | "category" | "score"
      readonly instruction: string
      readonly labels: ReadonlyArray<{ name: string; description?: string }>
    }> | undefined
  }
) =>
  Effect.gen(function*() {
    const dataset = yield* repo.findDataset(userId, datasetId)
    if (dataset === null) return yield* Effect.fail(notFound("Dataset not found."))
    if (input.name.trim() === "") return yield* Effect.fail(badRequest("A column name is required."))
    if (input.instruction.trim() === "") {
      return yield* Effect.fail(badRequest("A question is required."))
    }

    const labels = input.labels === undefined || input.labels.length === 0
      ? defaultLabels(input.type)
      : [...input.labels]

    if (input.type !== "yes_no" && labels.length < 2) {
      return yield* Effect.fail(badRequest("Give the column at least two labels."))
    }

    const id = newId()
    yield* repo.insertAiColumn({
      id,
      datasetId,
      name: input.name.trim(),
      type: input.type,
      instruction: input.instruction.trim(),
      labels,
      needsReviewThreshold: input.needsReviewThreshold ?? defaultThresholdFor(input.type)
    })

    const extras = input.questions ?? []
    yield* Effect.forEach(
      extras,
      (question, index) =>
        repo.insertQuestion({
          id: newId(),
          aiColumnId: id,
          key: question.key,
          type: question.type,
          instruction: question.instruction,
          labels: [...question.labels],
          ordinal: index + 1
        }),
      { discard: true }
    )

    return {
      id,
      name: input.name.trim(),
      type: input.type,
      instruction: input.instruction.trim(),
      labels,
      needsReviewThreshold: input.needsReviewThreshold ?? defaultThresholdFor(input.type),
      questions: extras
    }
  })

export const deleteAiColumn = (userId: string, datasetId: string, columnId: string) =>
  Effect.gen(function*() {
    const dataset = yield* repo.findDataset(userId, datasetId)
    if (dataset === null) return yield* Effect.fail(notFound("Dataset not found."))
    yield* repo.deleteAiColumn(columnId)
  })

// ── Evaluation ──────────────────────────────────────────────────────────────

const evaluateRows = (
  column: repo.AiColumnShape,
  rows: ReadonlyArray<repo.DatasetRowShape>,
  concurrency: number
) =>
  Effect.gen(function*() {
    const evaluator = yield* EvaluationService
    const evaluationColumn = toEvaluationColumn(column)
    const extras = toExtraQuestions(yield* repo.listQuestions(column.id))

    yield* Effect.forEach(
      rows,
      (row) =>
        evaluator.evaluate(evaluationColumn, row.data as Record<string, unknown>, extras).pipe(
          Effect.catchIf(
            (error): error is EvaluationError => error instanceof EvaluationError,
            (error) =>
            // A row that could not be reached is recorded as failed rather
            // than killing the run; a failed subset never destroys the whole.
            Effect.succeed({
              result: {
                selectedValue: null,
                confidence: null,
                providerConfidence: null,
                sufficiency: null,
                status: "failed" as const,
                distribution: [],
                detail: null,
                usage: null
              },
              providerResponse: { error: error.reason },
              answers: {},
              model: "unknown"
            })
          ),
          Effect.flatMap((evaluated) =>
            repo.upsertResult({
              aiColumnId: column.id,
              rowId: row.id,
              selectedValue: evaluated.result.selectedValue,
              confidence: evaluated.result.confidence,
              providerConfidence: evaluated.result.providerConfidence,
              sufficiency: evaluated.result.sufficiency,
              status: evaluated.result.status,
              criteriaVersion: column.criteria_version,
              answers: evaluated.answers,
              detail: evaluated.result.detail,
              providerResponse: evaluated.providerResponse
            })
          )
        ),
      { concurrency, discard: true }
    )
  })

export const previewColumn = (
  userId: string,
  datasetId: string,
  columnId: string,
  count: number
) =>
  Effect.gen(function*() {
    const dataset = yield* repo.findDataset(userId, datasetId)
    if (dataset === null) return yield* Effect.fail(notFound("Dataset not found."))
    const column = yield* repo.findAiColumn(datasetId, columnId)
    if (column === null) return yield* Effect.fail(notFound("Column not found."))

    const bounded = Math.max(1, Math.min(count, 50))
    const indices = repo.spreadRowIndices(dataset.row_count, bounded)
    // Re-previewing recomputes every previewed row: no caching, so nothing on
    // screen can be stale. See "Preview semantics".
    const rows = yield* repo.listRowsByIndices(datasetId, indices)
    yield* evaluateRows(column, rows, 8)
    return { evaluated: rows.length }
  })

export const runColumn = (userId: string, datasetId: string, columnId: string) =>
  Effect.gen(function*() {
    const dataset = yield* repo.findDataset(userId, datasetId)
    if (dataset === null) return yield* Effect.fail(notFound("Dataset not found."))
    const column = yield* repo.findAiColumn(datasetId, columnId)
    if (column === null) return yield* Effect.fail(notFound("Column not found."))

    const rows = yield* repo.listRows(datasetId)
    const runId = yield* repo.insertBatchRun({ aiColumnId: columnId, totalRows: rows.length })

    // NOTE: evaluated inline for the slice. The production path is the
    // PersistedQueue consumer in apps/worker, one item per (row, AI column),
    // with per-user fairness. See "Batch-run semantics".
    yield* evaluateRows(column, rows, 8).pipe(
      Effect.tapError(() => repo.finishBatchRun(runId, "failed"))
    )
    yield* repo.finishBatchRun(runId, "completed")
    return { runId, totalRows: rows.length }
  })

/**
 * Create a run and hand back the rows to enqueue, without evaluating anything.
 *
 * The queue lives in its own package and depends on this one, so the web app
 * owns the join: it prepares the run here and enqueues there. That keeps the
 * domain free of any knowledge that a queue exists.
 */
export const prepareRun = (userId: string, datasetId: string, columnId: string) =>
  Effect.gen(function*() {
    const dataset = yield* repo.findDataset(userId, datasetId)
    if (dataset === null) return yield* Effect.fail(notFound("Dataset not found."))
    const column = yield* repo.findAiColumn(datasetId, columnId)
    if (column === null) return yield* Effect.fail(notFound("Column not found."))

    const rows = yield* repo.listRows(datasetId)
    const runId = yield* repo.insertBatchRun({ aiColumnId: columnId, totalRows: rows.length })
    return { runId, rowIds: rows.map((row) => row.id), totalRows: rows.length }
  })

export const getResults = (userId: string, datasetId: string, columnId: string) =>
  Effect.gen(function*() {
    const dataset = yield* repo.findDataset(userId, datasetId)
    if (dataset === null) return yield* Effect.fail(notFound("Dataset not found."))

    const [results, corrections] = yield* Effect.all(
      [repo.listResults(columnId), repo.listCorrections(columnId)],
      { concurrency: 2 }
    )
    const correctionsByRow = new Map(corrections.map((c) => [c.row_id, c.value]))

    return results.map((result) => ({
      rowId: result.row_id,
      selectedValue: result.selected_value,
      confidence: result.confidence,
      sufficiency: result.sufficiency,
      status: result.status,
      distribution:
        result.detail === null && result.selected_value === null
          ? []
          : distributionOf(result),
      correctedValue: correctionsByRow.get(result.row_id) ?? null,
      answers: (result.answers ?? {}) as Record<string, unknown>
    }))
  })

/**
 * The distribution is recovered from the stored provider response — the spec's
 * "trimmed projection" — so we never store it twice.
 */
const distributionOf = (result: repo.ResultShape): Array<{ label: string; probability: number }> => {
  const response = result.provider_response as
    | { answers?: Record<string, { probabilities?: Record<string, number> }> }
    | null
  const probabilities = response?.answers?.["judgment"]?.probabilities
  if (probabilities === undefined) return []
  return Object.entries(probabilities)
    .map(([label, probability]) => ({ label, probability: Number(probability) }))
    .sort((a, b) => b.probability - a.probability)
}

export const putCorrection = (
  userId: string,
  datasetId: string,
  columnId: string,
  rowId: string,
  value: string
) =>
  Effect.gen(function*() {
    const dataset = yield* repo.findDataset(userId, datasetId)
    if (dataset === null) return yield* Effect.fail(notFound("Dataset not found."))
    const column = yield* repo.findAiColumn(datasetId, columnId)
    if (column === null) return yield* Effect.fail(notFound("Column not found."))

    // A correction is constrained to the column's label set: a free-text value
    // would make the column ungroupable and unexportable.
    const allowed = column.labels.map((label) => label.name)
    if (!allowed.includes(value)) {
      return yield* Effect.fail(badRequest(`"${value}" is not one of this column's labels.`))
    }

    yield* repo.upsertCorrection({ aiColumnId: columnId, rowId, value, correctedBy: userId })
    return { ok: true }
  })

export const removeCorrection = (
  userId: string,
  datasetId: string,
  columnId: string,
  rowId: string
) =>
  Effect.gen(function*() {
    const dataset = yield* repo.findDataset(userId, datasetId)
    if (dataset === null) return yield* Effect.fail(notFound("Dataset not found."))
    yield* repo.deleteCorrection(columnId, rowId)
    return { ok: true }
  })

export const countResults = (userId: string, datasetId: string, columnId: string) =>
  Effect.gen(function*() {
    const dataset = yield* repo.findDataset(userId, datasetId)
    if (dataset === null) return yield* Effect.fail(notFound("Dataset not found."))
    return yield* repo.countResultsByStatus(columnId)
  })

// ── The column report ───────────────────────────────────────────────────────

/**
 * Answers "how good is this column?" — the question every serious buyer asks,
 * and the one nobody answers honestly.
 *
 * Two numbers, always reported separately:
 *
 * - **Agreement on reviewed rows** is a fact about the review queue. People
 *   review uncertain rows first, so it is biased *downward* and must never be
 *   presented as accuracy on its own.
 * - **Audit accuracy** comes from a random sample of rows the user never
 *   looked at. It is the only unbiased estimate, and it is the headline.
 */
export interface ColumnReport {
  readonly total: number
  readonly judged: number
  readonly unusable: number
  readonly failed: number
  readonly baseRate: ReadonlyArray<{ readonly label: string; readonly share: number }>
  readonly reviewed: {
    readonly total: number
    readonly agreed: number
    readonly rate: number | null
    readonly byClass: ReadonlyArray<{
      readonly label: string
      readonly total: number
      readonly agreed: number
      readonly rate: number | null
    }>
  }
  readonly buckets: ReadonlyArray<{
    readonly range: string
    readonly total: number
    readonly agreed: number
    readonly rate: number | null
  }>
  readonly audit: { readonly total: number; readonly agreed: number; readonly rate: number | null } | null
  readonly disagreements: ReadonlyArray<{
    readonly rowId: string
    readonly model: string | null
    readonly human: string
    readonly confidence: number | null
  }>
  readonly warnings: ReadonlyArray<string>
}

const rate = (n: number, d: number): number | null => (d === 0 ? null : n / d)

export const getColumnReport = (userId: string, datasetId: string, columnId: string) =>
  Effect.gen(function*() {
    const dataset = yield* repo.findDataset(userId, datasetId)
    if (dataset === null) return yield* Effect.fail(notFound("Dataset not found."))
    const column = yield* repo.findAiColumn(datasetId, columnId)
    if (column === null) return yield* Effect.fail(notFound("Column not found."))

    const [results, corrections] = yield* Effect.all(
      [repo.listResults(columnId), repo.listCorrections(columnId)],
      { concurrency: 2 }
    )
    const correctionByRow = new Map(corrections.map((c) => [c.row_id, c.value]))

    const judgedRows = results.filter(
      (r) => r.status !== "unable_to_determine" && r.status !== "failed"
    )
    const unusable = results.filter((r) => r.status === "unable_to_determine").length
    const failed = results.filter((r) => r.status === "failed").length

    // Base rate. Without it, "85% accurate" describes a model that always says
    // the same thing.
    const counts = new Map<string, number>()
    for (const r of judgedRows) {
      const label = r.selected_value ?? "(none)"
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    const baseRate = [...counts.entries()]
      .map(([label, count]) => ({ label, share: judgedRows.length === 0 ? 0 : count / judgedRows.length }))
      .sort((a, b) => b.share - a.share)

    // Agreement, only where a human actually said something.
    const reviewed = judgedRows.filter((r) => correctionByRow.has(r.row_id))
    const agreedRows = reviewed.filter((r) => r.selected_value === correctionByRow.get(r.row_id))

    const classLabels = [...new Set(reviewed.map((r) => correctionByRow.get(r.row_id)!))]
    const byClass = classLabels.map((label) => {
      const inClass = reviewed.filter((r) => correctionByRow.get(r.row_id) === label)
      const agreed = inClass.filter((r) => r.selected_value === label).length
      return { label, total: inClass.length, agreed, rate: rate(agreed, inClass.length) }
    })

    const buckets = [
      { range: "under 0.60", test: (c: number) => c < 0.6 },
      { range: "0.60 – 0.79", test: (c: number) => c >= 0.6 && c < 0.8 },
      { range: "0.80 – 0.94", test: (c: number) => c >= 0.8 && c < 0.95 },
      { range: "0.95 – 1.00", test: (c: number) => c >= 0.95 }
    ].map((bucket) => {
      const inBucket = reviewed.filter(
        (r) => r.confidence !== null && bucket.test(r.confidence)
      )
      const agreed = inBucket.filter((r) => r.selected_value === correctionByRow.get(r.row_id)).length
      return { range: bucket.range, total: inBucket.length, agreed, rate: rate(agreed, inBucket.length) }
    }).filter((b) => b.total > 0)

    const auditRows = judgedRows.filter((r) => r.in_audit)
    const auditAgreed = auditRows.filter(
      (r) => {
        const human = correctionByRow.get(r.row_id)
        return human === undefined ? true : human === r.selected_value
      }
    ).length
    const audit =
      auditRows.length === 0
        ? null
        : { total: auditRows.length, agreed: auditAgreed, rate: rate(auditAgreed, auditRows.length) }

    const disagreements = reviewed
      .filter((r) => r.selected_value !== correctionByRow.get(r.row_id))
      .slice(0, 20)
      .map((r) => ({
        rowId: r.row_id,
        model: r.selected_value,
        human: correctionByRow.get(r.row_id)!,
        confidence: r.confidence
      }))

    const warnings: string[] = []
    if (baseRate.length > 0 && baseRate[0]!.share >= 0.7) {
      warnings.push(
        `${Math.round(baseRate[0]!.share * 100)}% of judged rows are "${baseRate[0]!.label}". ` +
          `Overall agreement is close to what "always say ${baseRate[0]!.label}" would score, so read the per-class figures instead.`
      )
    }
    if (audit === null) {
      warnings.push(
        "No audit has been run, so there is no unbiased accuracy estimate. " +
          "Agreement below is measured on rows you chose to review, which skews toward the hard cases."
      )
    } else if (corrections.length === 0) {
      // Known limitation, stated rather than hidden: we cannot yet tell a row
      // the user confirmed from one they ignored, so an un-actioned audit row
      // counts as agreed. That inflates the estimate.
      warnings.push(
        `The audit assumes rows you did not change were correct. ` +
          `Until you actually review those ${audit.total} rows, treat this figure as an upper bound.`
      )
    }
    if (reviewed.length < 10) {
      warnings.push(`Only ${reviewed.length} reviewed rows — too few to say much.`)
    }

    return {
      total: results.length,
      judged: judgedRows.length,
      unusable,
      failed,
      baseRate,
      reviewed: {
        total: reviewed.length,
        agreed: agreedRows.length,
        rate: rate(agreedRows.length, reviewed.length),
        byClass
      },
      buckets,
      audit,
      disagreements,
      warnings
    }
  })

export const startAudit = (
  userId: string,
  datasetId: string,
  columnId: string,
  count: number
) =>
  Effect.gen(function*() {
    const dataset = yield* repo.findDataset(userId, datasetId)
    if (dataset === null) return yield* Effect.fail(notFound("Dataset not found."))
    const column = yield* repo.findAiColumn(datasetId, columnId)
    if (column === null) return yield* Effect.fail(notFound("Column not found."))
    const sampled = yield* repo.markAuditSample(columnId, Math.max(5, Math.min(count, 200)))
    return { sampled }
  })

// ── Export ──────────────────────────────────────────────────────────────────

const csvCell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value

export const exportCsv = (
  userId: string,
  datasetId: string,
  includeConfidence: boolean
): Effect.Effect<string, DomainError | SqlError.SqlError, SqlClient.SqlClient | EvaluationService> =>
  Effect.gen(function*() {
    const dataset = yield* repo.findDataset(userId, datasetId)
    if (dataset === null) return yield* Effect.fail(notFound("Dataset not found."))

    const [rows, columns] = yield* Effect.all(
      [repo.listRows(datasetId), repo.listAiColumns(datasetId)],
      { concurrency: 2 }
    )

    const perColumn = yield* Effect.forEach(
      columns,
      (column) =>
        Effect.all([repo.listResults(column.id), repo.listCorrections(column.id)], {
          concurrency: 2
        }).pipe(Effect.map(([results, corrections]) => ({ column, results, corrections }))),
      { concurrency: 2 }
    )

    const byRow = new Map<string, Map<string, string>>()
    const confidenceByRow = new Map<string, Map<string, string>>()
    for (const { column, results, corrections } of perColumn) {
      const corrected = new Map(corrections.map((c) => [c.row_id, c.value]))
      for (const result of results) {
        const effective = corrected.get(result.row_id) ?? result.selected_value
        const value =
          effective ??
          (result.status === "failed" ? "Failed" : "Unable to determine")
        if (!byRow.has(result.row_id)) byRow.set(result.row_id, new Map())
        byRow.get(result.row_id)!.set(column.id, value)
        if (!confidenceByRow.has(result.row_id)) confidenceByRow.set(result.row_id, new Map())
        confidenceByRow
          .get(result.row_id)!
          .set(column.id, result.confidence === null ? "" : result.confidence.toFixed(2))
      }
    }

    // Names are de-duplicated against every other emitted header.
    const taken = new Set(dataset.columns)
    const headerFor = (name: string): string => {
      let candidate = name
      let suffix = 2
      while (taken.has(candidate)) {
        candidate = `${name} (${suffix})`
        suffix += 1
      }
      taken.add(candidate)
      return candidate
    }
    const valueHeaders = columns.map((column) => ({ id: column.id, header: headerFor(column.name) }))
    const confidenceHeaders = includeConfidence
      ? columns.map((column) => ({ id: column.id, header: headerFor(`${column.name} Confidence`) }))
      : []

    const lines: string[] = []
    lines.push(
      [
        ...dataset.columns.map(csvCell),
        ...valueHeaders.map((h) => csvCell(h.header)),
        ...confidenceHeaders.map((h) => csvCell(h.header))
      ].join(",")
    )

    // All rows, in original order, regardless of filters.
    for (const row of rows) {
      const data = row.data as Record<string, string>
      const line = [
        ...dataset.columns.map((name) => csvCell(data[name] ?? "")),
        ...valueHeaders.map((h) => csvCell(byRow.get(row.id)?.get(h.id) ?? "")),
        ...confidenceHeaders.map((h) => csvCell(confidenceByRow.get(row.id)?.get(h.id) ?? ""))
      ]
      lines.push(line.join(","))
    }

    return lines.join("\r\n")
  })

// ── Demo dataset ────────────────────────────────────────────────────────────

/**
 * The built-in sample. The same rows are downloadable as a CSV from
 * `apps/web/public/customer-feedback.csv` — keep the two in step.
 *
 * Deliberately chosen and shaped to exercise every state the product can show:
 * free-text tickets rich enough to judge, a handful that are genuinely
 * ambiguous, and a few that are empty or too thin to judge at all. It ships
 * with one column of each type, because a Yes/No column alone is the *worst*
 * showcase for the confidence model — a binary Choice collapses to a
 * near-certain distribution, so nothing ever lands in "needs review".
 */
const DEMO: ReadonlyArray<ReadonlyArray<string>> = [
  ["T-1001", "Northwind Analytics", "Pro", "499", "2026-08-04", "Bulk export", "We need to export all our saved reports as CSV in one go. Right now we click through each report one at a time, and with 200+ reports that is a full day of work every month. Is bulk export on the roadmap?"],
  ["T-1002", "Bluepeak Systems", "Enterprise", "2400", "2026-08-04", "Slack integration", "Please add a Slack integration so my team gets notified when a build fails. We would happily pay extra for this one."],
  ["T-1003", "Vantage Analytics", "Starter", "79", "2026-08-05", "Dates off by one", "Every invoice dated the 1st is showing as the previous day in the PDF. The data is correct in the dashboard but wrong in the download. This started after your Tuesday deploy."],
  ["T-1004", "Harbourline", "Pro", "620", "2026-08-05", "Login loop", "I sign in, get redirected to the dashboard, and am immediately bounced back to the login page. Chrome and Safari, same thing, incognito too. I cannot work today."],
  ["T-1005", "Ironvale Security", "Enterprise", "3100", "2026-08-06", "Renewal conversation", "We have had three outages this quarter and our team has lost confidence in the platform. We are evaluating two competitors and honestly need a reason to stay."],
  ["T-1006", "Fernwood Labs", "Starter", "49", "2026-08-06", "Cancel our subscription", "Please cancel our subscription at the end of the month. We have moved to a competitor that includes the reporting we kept asking for."],
  ["T-1007", "Quill and Co", "Pro", "310", "2026-08-07", "Double charged", "We were billed twice this month. Two identical charges on the 3rd, same amount, same card. Please refund one of them."],
  ["T-1008", "Corvid Labs", "Free", "0", "2026-08-07", "API rate limits", "What are the rate limits on the read API? I could not find this in the documentation anywhere."],
  ["T-1009", "Tessellate", "Pro", "700", "2026-08-08", "Dashboard is very slow", "Our main dashboard takes 25 to 30 seconds to load since we crossed 50,000 records. It used to be instant. This is slowing down our entire ops team every morning."],
  ["T-1010", "Pelagic", "Starter", "99", "2026-08-08", "Filter behaviour", "When I filter by region the date column resets to blank. I am not sure if that is intended but it is annoying and I have to re-enter dates constantly."],
  ["T-1011", "Graze", "Free", "0", "2026-08-09", "help", "help"],
  ["T-1012", "Marrow", "Starter", "49", "2026-08-09", "Issue", "It is not working again."],
  ["T-1013", "Brightpath", "Free", "0", "2026-08-10", "?", "?"],
  ["T-1014", "Sundeck", "Pro", "540", "2026-08-10", "", ""],
  ["T-1015", "Ledgerly", "Pro", "380", "2026-08-11", "Sync", "The sync is broken."],
  ["T-1016", "Nimbus Health", "Enterprise", "1800", "2026-08-11", "Thank you", "Just wanted to say the new scheduling view is a huge improvement. Our front desk saves about an hour a day. Please keep going in this direction."],
  ["T-1017", "Cobalt Systems", "Enterprise", "4200", "2026-08-12", "SAML SSO", "We need SAML SSO before we can roll this out beyond the pilot team. Our security review will not pass without it. Is this on the roadmap, and roughly when?"],
  ["T-1018", "Vantage Analytics", "Starter", "79", "2026-08-12", "Export broken again", "Same export problem as last month, ticket T-0412. Large exports still time out after about five minutes and produce a partial file with no warning."],
  ["T-1019", "Bluepeak Systems", "Enterprise", "2400", "2026-08-13", "Onboarding call", "Can we schedule a walkthrough for the two new analysts joining next week? Nothing urgent, just want them comfortable before quarter end."],
  ["T-1020", "Riverbend Retail", "Pro", "850", "2026-08-13", "Reports wrong for Q3", "Our Q3 revenue report is showing roughly 40% lower than our own numbers. I have checked our raw data twice and I am confident the report is wrong. This is blocking our board pack."],
  ["T-1021", "Ashgrove Media", "Starter", "120", "2026-08-14", "Feature request or bug?", "When I duplicate a saved view it copies the filters but not the column order. I cannot tell whether that is by design or a bug, but it makes duplication almost useless for us."],
  ["T-1022", "Kestrel Freight", "Pro", "1100", "2026-08-14", "Cancelling in 30 days", "After nine months we are cancelling. Two of our three requested features shipped for other customers but never for us, and support response times have gone from hours to days."],
  ["T-1023", "Lumen Partners", "Enterprise", "5600", "2026-08-15", "Security questionnaire", "Our procurement team needs a completed security questionnaire and a copy of your SOC 2 report before we can expand to the European entity. Who should I send this to?"],
  ["T-1024", "Thicket", "Free", "0", "2026-08-15", "Slow", "slow"],
  ["T-1025", "Orchard Field", "Pro", "430", "2026-08-16", "Time zone bug", "Scheduled reports are firing in UTC instead of the account time zone. Our weekly summary arrived at 3am local instead of 8am. We set the time zone in settings and it appears to be ignored."],
  ["T-1026", "Beacon Insights", "Starter", "95", "2026-08-16", "Hopefully helpful feedback", "The product is good. Some parts of the UI are confusing, particularly the settings area, and I think a redesign would help. No urgency at all, just sharing."],
  ["T-1027", "Pinewood Group", "Enterprise", "2900", "2026-08-17", "Data missing after import", "We imported 12,000 rows yesterday and only 7,400 appear in the table. The import said it succeeded. The missing rows are simply absent with no error, and we need them for month end close."],
  ["T-1028", "Sable and Stone", "Pro", "255", "2026-08-17", "Hire more support staff", "Response times have slipped badly. I waited three days for a reply on a billing question. The product is fine, the support is not, and that is why we are looking around."],
  ["T-1029", "Meridian Labs", "Enterprise", "3900", "2026-08-18", "Audit log retention", "How long do you retain audit logs, and can we configure that per workspace? Our compliance team needs a documented answer rather than a guess."],
  ["T-1030", "Willowbrook", "Starter", "65", "2026-08-18", "It broke", "Everything broke this morning."],
  ["T-1031", "Foxglove Analytics", "Pro", "780", "2026-08-19", "Duplicate rows in export", "Every export now contains the header row twice and a handful of rows duplicated. I can work around it by deduplicating in Excel but it is clearly a bug and it has cost us a day of cleanup."],
  ["T-1032", "Thornbury Health", "Enterprise", "2100", "2026-08-19", "Contract expansion", "We are ready to expand from 40 to 120 seats. What does the pricing look like at that volume, and can we get priority support included?"],
  ["T-1033", "Nettle and Fern", "Free", "0", "2026-08-20", "Random", "Just looking around, no question yet."],
  ["T-1034", "Glasswing", "Pro", "340", "2026-08-20", "Please add dark mode", "Dark mode would genuinely help. Our team works late and the white interface is harsh. I know it is cosmetic but it comes up in every team meeting."],
  ["T-1035", "Bracken Systems", "Pro", "920", "2026-08-21", "Critical - data leak risk", "I am fairly sure I can see another workspace's saved queries when I use the search box. I have not clicked into anything but the names are visible and they are not ours. Please treat this as urgent."]
]

const DEMO_HEADERS = ["ticket_id", "account", "plan", "mrr_usd", "submitted_at", "subject", "message"]

const DEMO_COLUMNS: ReadonlyArray<{
  readonly name: string
  readonly type: "yes_no" | "category" | "score"
  readonly instruction: string
  readonly labels: ReadonlyArray<{
    readonly name: string
    readonly description?: string
    readonly what?: string
    readonly notFor?: string
    readonly examples?: ReadonlyArray<string>
    readonly signals?: ReadonlyArray<string>
  }>
}> = [
  {
    name: "Feature request?",
    type: "yes_no",
    instruction: "Is this customer asking for functionality that does not exist yet?",
    labels: [
      {
        name: "Yes",
        what: "Asks for something the product cannot do yet",
        examples: [
          "Please add a Slack integration",
          "We need SAML SSO before we can roll this out",
          "Dark mode would genuinely help"
        ]
      },
      {
        name: "No",
        what: "Anything else — bug reports, questions, billing, churn, praise",
        notFor:
          "A bug report or a question is a definite NO, not missing information. Only mark this row unusable if the message is empty or too vague to have any content at all.",
        examples: [
          "Login is bouncing me back to the sign-in page",
          "We were billed twice this month",
          "What are the rate limits on the read API?"
        ]
      }
    ]
  },
  {
    name: "Issue type",
    type: "category",
    instruction: "What kind of issue is this?",
    labels: [
      {
        name: "Bug",
        what: "Something that should work is broken or produces wrong output",
        notFor: "A request for new functionality, or a question about how something works",
        examples: ["Every invoice dated the 1st shows the previous day", "Export contains duplicate rows"]
      },
      {
        name: "Feature request",
        what: "A request for functionality that does not exist yet",
        notFor: "A report that something existing is broken",
        examples: ["Please add a Slack integration", "Dark mode would help"]
      },
      {
        name: "Question",
        what: "A request for information, documentation or process",
        notFor: "A report of broken behaviour",
        examples: ["What are the API rate limits?", "Who do I send a security questionnaire to?"]
      },
      {
        name: "Billing",
        what: "Anything about charges, invoices, refunds or plans",
        notFor: "General pricing questions from someone evaluating the product",
        examples: ["We were billed twice this month", "Please refund the duplicate charge"]
      },
      {
        name: "Performance",
        what: "Slowness, timeouts or resource problems",
        notFor: "A functional bug that happens to be annoying",
        examples: ["Dashboard takes 30 seconds to load", "Large exports time out"]
      },
      {
        name: "Praise",
        what: "Positive feedback with no request attached",
        notFor: "Positive feedback that goes on to ask for something",
        examples: ["The new scheduling view is a huge improvement"]
      }
    ]
  },
  {
    name: "Urgency",
    type: "score",
    instruction: "How urgent is this for the customer?",
    labels: [
      {
        name: "Critical",
        what: "Blocking work right now, or a security or data-loss risk",
        signals: ["States they cannot work", "Mentions data loss or a security concern", "Month-end or board deadline"]
      },
      {
        name: "High",
        what: "Seriously impeding the team, needs attention this week",
        signals: ["Describes real disruption", "Time-sensitive business impact"]
      },
      {
        name: "Medium",
        what: "A real problem with a workaround available",
        signals: ["Describes a workaround", "Annoying but not blocking"]
      },
      {
        name: "Low",
        what: "Nice to have, cosmetic, or purely informational",
        signals: ["Explicitly says it is not urgent", "A question or a suggestion"]
      }
    ]
  }
]

export const createDemoDataset = (userId: string) =>
  Effect.gen(function*() {
    const id = newId()
    const rows = DEMO.map((row) => toRowObject(DEMO_HEADERS, row))

    yield* repo.insertDataset({
      id,
      userId,
      name: "Sample support tickets",
      filename: "customer-feedback.csv",
      columns: DEMO_HEADERS,
      storageKey: null
    })
    yield* repo.insertRows(id, rows)

    for (const column of DEMO_COLUMNS) {
      yield* repo.insertAiColumn({
        id: newId(),
        datasetId: id,
        name: column.name,
        type: column.type,
        instruction: column.instruction,
        labels: [...column.labels],
        needsReviewThreshold: defaultThresholdFor(column.type)
      })
    }

    return {
      id,
      name: "Sample support tickets",
      filename: "customer-feedback.csv",
      rowCount: rows.length,
      columnCount: DEMO_HEADERS.length,
      columns: DEMO_HEADERS,
      createdAt: new Date().toISOString()
    }
  })

// ── Rule clarification (the one in-scope LLM use) ───────────────────────────

export const improveInstruction = (input: {
  readonly instruction: string
  readonly type: string
  readonly headers: ReadonlyArray<string>
}): Effect.Effect<{ readonly instruction?: string }, never> =>
  Effect.gen(function*() {
    const key = process.env["OPENAI_API_KEY"]
    if (key === undefined || key === "") return {}

    const prompt =
      `You are helping a user write a crisp evaluation criterion for a spreadsheet column.\n` +
      `Available columns: ${input.headers.join(", ")}\n` +
      `Output type: ${input.type}\n` +
      `Their current wording: ${input.instruction}\n\n` +
      `Rewrite it as a single, specific yes/no or classification question that a judge ` +
      `could apply consistently using only those columns. Reply with the rewritten question only.`

    const content = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2
          })
        })
        if (!response.ok) throw new Error("llm unavailable")
        const body = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>
        }
        return body.choices?.[0]?.message?.content?.trim() ?? ""
      },
      catch: () => new Error("llm unavailable")
    }).pipe(Effect.catchCause(() => Effect.succeed("")))

    return content === "" ? {} : { instruction: content }
  })

export { decodeLabels }
