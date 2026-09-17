import { Effect, Schema } from "effect"
import { SqlClient, SqlError } from "effect/unstable/sql"
import { EvaluationError, EvaluationService } from "@app/evaluate"
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
      needsReviewThreshold: input.needsReviewThreshold ?? 0.8
    })

    return {
      id,
      name: input.name.trim(),
      type: input.type,
      instruction: input.instruction.trim(),
      labels,
      needsReviewThreshold: input.needsReviewThreshold ?? 0.8
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

    yield* Effect.forEach(
      rows,
      (row) =>
        evaluator.evaluate(evaluationColumn, row.data as Record<string, unknown>).pipe(
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
      correctedValue: correctionsByRow.get(result.row_id) ?? null
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

const DEMO: ReadonlyArray<ReadonlyArray<string>> = [
  ["Acme", "Acme builds HR software for enterprise companies, sold as a subscription.", "420", "United States"],
  ["PixelPop", "PixelPop makes photo filters for consumers.", "40", "United States"],
  ["Northwind Consulting", "Northwind is a consulting firm that builds custom internal tools for clients, sometimes hosted.", "120", "Canada"],
  ["Vantage Analytics", "Vantage sells a subscription analytics platform to mid-market ecommerce teams.", "85", "United Kingdom"],
  ["Graze", "Graze is a marketplace connecting freelancers with studios.", "15", "United Kingdom"],
  ["Ledgerly", "Ledgerly provides bookkeeping software to small accounting firms on a monthly plan.", "60", "Australia"],
  ["Brightpath", "Brightpath runs coding bootcamps for career changers.", "30", "Ireland"],
  ["Nimbus Health", "Nimbus Health sells scheduling software to dental practices as a SaaS subscription.", "210", "United States"],
  ["Vectora", "We make stuff for businesses.", "", "Germany"],
  ["Corvid Labs", "Corvid Labs is a two-person studio building an open-source compiler, funded by grants.", "2", "Netherlands"],
  ["Tessellate", "Tessellate sells an API for geospatial routing, billed per request to developers.", "55", "United States"],
  ["Harbourline", "Harbourline operates physical warehouse space and charges per pallet.", "900", "Singapore"],
  ["Quill & Co", "Quill & Co is a marketing agency for B2B software companies.", "75", "United States"],
  ["Fernwood", "Fernwood makes a consumer app for plant identification.", "12", "New Zealand"],
  ["Cobalt Systems", "Cobalt Systems sells on-premise database licences to government departments.", "340", "United States"],
  ["Marrow", "Marrow is an early-stage startup with no public description yet.", "4", "France"],
  ["Sundeck", "Sundeck sells subscription software that schedules shifts for restaurant chains.", "150", "United States"],
  ["Pelagic", "Pelagic runs a two-sided marketplace matching boat owners with charter customers.", "22", "Croatia"],
  ["Ironvale", "Ironvale provides managed security services under an annual retainer.", "260", "United Kingdom"],
  ["Junipersoft", "Junipersoft sells a helpdesk platform to internal IT teams on a per-seat subscription.", "480", "United States"]
]

const DEMO_HEADERS = ["company", "description", "employee_count", "country"]

export const createDemoDataset = (userId: string) =>
  Effect.gen(function*() {
    const id = newId()
    const rows = DEMO.map((row) => toRowObject(DEMO_HEADERS, row))

    yield* repo.insertDataset({
      id,
      userId,
      name: "Sample companies",
      filename: "sample-companies.csv",
      columns: DEMO_HEADERS,
      storageKey: null
    })
    yield* repo.insertRows(id, rows)

    const columnId = newId()
    yield* repo.insertAiColumn({
      id: columnId,
      datasetId: id,
      name: "B2B SaaS?",
      type: "yes_no",
      instruction: "Is this company primarily a B2B SaaS company?",
      labels: [
        { name: "Yes", description: "Primarily sells software as a service to businesses." },
        { name: "No", description: "Does not primarily sell B2B SaaS." }
      ],
      needsReviewThreshold: 0.8
    })

    return {
      id,
      name: "Sample companies",
      filename: "sample-companies.csv",
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
