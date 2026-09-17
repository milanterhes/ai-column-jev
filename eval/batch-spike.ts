/**
 * Row-batching spike (T12).
 *
 * The measured premise: a question is nearly free, but a row's *text* cannot be
 * amortised across columns, because every request carries the state. The next
 * lever is amortising the per-request overhead across *rows* — many rows in one
 * `state`, many questions per row.
 *
 * This script measures three shapes against the live API:
 *
 *   1. N calls, one row each, one question each.
 *   2. 1 call, N rows in one `state`, N questions (one per row).
 *   3. 1 call, N rows in one `state`, one question over the whole set.
 *
 * The question is whether 2 keeps answers attributable to their row while
 * cutting input tokens, and what 3 can and cannot express.
 *
 *   npx tsx eval/batch-spike.ts
 */
import { existsSync, readFileSync } from "node:fs"
import { renderState } from "../packages/evaluate/src/core.ts"

if (existsSync(".env")) process.loadEnvFile(".env")

const API_KEY = process.env["JEV_KEY"]
const BASE_URL = (process.env["JEV_BASE_URL"] ?? "https://api.typesafe.ai").replace(/\/+$/, "")
const MODEL = process.env["JEV_MODEL"] ?? "jev-latest"
const CSV_PATH = "apps/web/public/customer-feedback.csv"
const REQUEST_TOKEN_BUDGET = 32_000

if (API_KEY === undefined || API_KEY === "") {
  console.error("JEV_KEY is not set")
  process.exit(1)
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = []
  let field = ""
  let row: string[] = []
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ",") {
      row.push(field)
      field = ""
    } else if (char === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else if (char !== "\r") {
      field += char
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const csv = parseCsv(readFileSync(CSV_PATH, "utf8"))
const headers = csv[0]!
const sampleRows: ReadonlyArray<Readonly<Record<string, string>>> = csv
  .slice(1)
  .filter((cells) => cells.some((cell) => cell.trim() !== ""))
  .map((cells) => Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ""])))

/** `n` rows drawn cyclically from the 35-row sample; each gets a unique id. */
const makeRows = (n: number): ReadonlyArray<{ readonly id: string; readonly data: Readonly<Record<string, string>> }> =>
  Array.from({ length: n }, (_, i) => ({
    id: `row_${i}`,
    data: sampleRows[i % sampleRows.length]!
  }))

// ---------------------------------------------------------------------------
// Jev
// ---------------------------------------------------------------------------

interface JevAnswer {
  readonly type?: string
  readonly choice?: string
  readonly confidence?: number
  readonly probabilities?: Record<string, number>
}

interface JevResponse {
  readonly model?: string
  readonly answers?: Record<string, JevAnswer>
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number }
}

interface JevCall {
  readonly status: number
  readonly json: JevResponse
  readonly inputTokens: number
  readonly outputTokens: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const callJev = async (body: unknown, attempt = 1): Promise<JevCall> => {
  const response = await fetch(`${BASE_URL}/v1/systemone`, {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  })
  const text = await response.text()
  let json: JevResponse = {}
  try {
    json = JSON.parse(text)
  } catch {
    json = {}
  }
  if ((response.status === 429 || response.status === 529 || response.status >= 500) && attempt <= 4) {
    const header = Number(response.headers.get("retry-after"))
    const wait = Number.isFinite(header) && header > 0 ? header * 1000 : Math.min(2 ** attempt * 500, 8000)
    await sleep(wait)
    return callJev(body, attempt + 1)
  }
  return {
    status: response.status,
    json,
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0
  }
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

const JUDGMENT_QUESTION = "Does this customer want a new feature to be built?"

const yesNoCriteria = {
  Yes: { what: "The customer explicitly asks for a new capability to be built or added." },
  No: {
    what: "The customer reports a bug, asks a question, thanks the team, or otherwise does not ask for new functionality."
  }
}

const judgmentQuestion = (question: string, inspect: string) => ({
  type: "choice",
  instructions: { question, inspect },
  criteria: yesNoCriteria
})

const readChoice = (json: JevResponse, id: string): string | null => json.answers?.[id]?.choice ?? null

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

interface ShapeResult {
  readonly shape: string
  readonly n: number
  readonly calls: number
  readonly failures: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly latencyMs: number
  readonly answersReturned: number
  readonly attributableRows: number
  readonly values: Readonly<Record<string, string | null>>
}

const blankValues = (
  rows: ReadonlyArray<{ readonly id: string }>
): Record<string, string | null> => Object.fromEntries(rows.map(({ id }) => [id, null]))

const shapeOneCallPerRow = async (
  rows: ReadonlyArray<{ readonly id: string; readonly data: Readonly<Record<string, string>> }>
): Promise<ShapeResult> => {
  const values = blankValues(rows)
  let inputTokens = 0
  let outputTokens = 0
  let failures = 0
  const started = performance.now()
  for (const { id, data } of rows) {
    const call = await callJev({
      state: renderState(data),
      model: MODEL,
      questions: { judgment: judgmentQuestion(JUDGMENT_QUESTION, "`subject`, `message`") }
    })
    inputTokens += call.inputTokens
    outputTokens += call.outputTokens
    if (call.status !== 200) {
      failures++
      continue
    }
    values[id] = readChoice(call.json, "judgment")
  }
  return {
    shape: "one-call-per-row",
    n: rows.length,
    calls: rows.length,
    failures,
    inputTokens,
    outputTokens,
    latencyMs: Math.round(performance.now() - started),
    answersReturned: Object.values(values).filter((value) => value !== null).length,
    attributableRows: Object.values(values).filter((value) => value !== null).length,
    values
  }
}

const batchedState = (rows: ReadonlyArray<{ readonly id: string; readonly data: Readonly<Record<string, string>> }>) => ({
  rows: rows.map(({ id, data }) => ({ id, ...renderState(data) }))
})

const shapeOneCallManyQuestions = async (
  rows: ReadonlyArray<{ readonly id: string; readonly data: Readonly<Record<string, string>> }>
): Promise<ShapeResult> => {
  const values = blankValues(rows)
  const questions: Record<string, unknown> = {}
  rows.forEach((row, i) => {
    questions[row.id] = judgmentQuestion(
      `${JUDGMENT_QUESTION} Judge only the row at rows[${i}] (id ${row.id}).`,
      `\`rows[${i}].subject\`, \`rows[${i}].message\``
    )
  })
  const started = performance.now()
  const call = await callJev({ state: batchedState(rows), model: MODEL, questions })
  const latencyMs = Math.round(performance.now() - started)
  if (call.status === 200) {
    for (const { id } of rows) values[id] = readChoice(call.json, id)
  }
  const answered = Object.values(values).filter((value) => value !== null).length
  return {
    shape: "one-call-many-questions",
    n: rows.length,
    calls: 1,
    failures: call.status === 200 ? 0 : 1,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    latencyMs,
    answersReturned: answered,
    attributableRows: answered,
    values
  }
}

const shapeOneCallOneQuestion = async (
  rows: ReadonlyArray<{ readonly id: string; readonly data: Readonly<Record<string, string>> }>
): Promise<ShapeResult> => {
  const values = blankValues(rows)
  const criteria = Object.fromEntries(
    rows.map(({ id, data }) => [id, `${data["subject"] ?? ""} — ${(data["message"] ?? "").slice(0, 80)}`])
  )
  const started = performance.now()
  const call = await callJev({
    state: batchedState(rows),
    model: MODEL,
    questions: {
      best_row: {
        type: "choice",
        instructions: {
          question: "Which single row is the clearest request for a new feature? Answer with one row id.",
          inspect: "rows[*].message"
        },
        criteria
      }
    }
  })
  const latencyMs = Math.round(performance.now() - started)
  const chosen = call.status === 200 ? readChoice(call.json, "best_row") : null
  if (chosen !== null && chosen in values) values[chosen] = "Yes"
  return {
    shape: "one-call-one-question",
    n: rows.length,
    calls: 1,
    failures: call.status === 200 ? 0 : 1,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    latencyMs,
    answersReturned: chosen === null ? 0 : 1,
    attributableRows: chosen === null ? 0 : 1,
    values
  }
}

// ---------------------------------------------------------------------------
// Ceiling probe
// ---------------------------------------------------------------------------

interface CeilingProbe {
  readonly n: number
  readonly status: number
  readonly bytes: number
  readonly inputTokens: number
  readonly answers: number
  readonly latencyMs: number
}

const probeCeiling = async (): Promise<ReadonlyArray<CeilingProbe>> => {
  const results: CeilingProbe[] = []
  for (const n of [100, 200, 220, 240, 250]) {
    const rows = makeRows(n)
    const questions: Record<string, unknown> = {}
    rows.forEach((row, i) => {
      questions[row.id] = judgmentQuestion(
        `${JUDGMENT_QUESTION} Judge only the row at rows[${i}] (id ${row.id}).`,
        `\`rows[${i}].subject\`, \`rows[${i}].message\``
      )
    })
    const body = { state: batchedState(rows), model: MODEL, questions }
    const started = performance.now()
    const call = await callJev(body)
    results.push({
      n,
      status: call.status,
      bytes: JSON.stringify(body).length,
      inputTokens: call.inputTokens,
      answers: Object.keys(call.json.answers ?? {}).length,
      latencyMs: Math.round(performance.now() - started)
    })
    if (call.status !== 200) break
  }
  return results
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const agreement = (left: ShapeResult, right: ShapeResult): number => {
  const shared = Object.keys(left.values).filter(
    (id) => left.values[id] !== null && right.values[id] !== null
  )
  if (shared.length === 0) return 0
  const same = shared.filter((id) => left.values[id] === right.values[id]).length
  return Math.round((same / shared.length) * 100)
}

const main = async (): Promise<void> => {
  console.log(`Jev batching spike — ${sampleRows.length} sample rows, model ${MODEL}`)
  if (process.argv[2] === "agreement") {
    for (const n of [100, 200]) {
      const rows = makeRows(n)
      const onePerRow = await shapeOneCallPerRow(rows)
      const manyQuestions = await shapeOneCallManyQuestions(rows)
      console.log(
        `N=${String(n).padStart(3)} per-row in=${onePerRow.inputTokens} ` +
          `batch in=${manyQuestions.inputTokens} (${((manyQuestions.inputTokens / onePerRow.inputTokens) * 100).toFixed(0)}%) ` +
          `batch answers=${manyQuestions.answersReturned}/${n} agreement=${agreement(onePerRow, manyQuestions)}%`
      )
    }
    return
  }
  if (process.argv[2] === "ceiling") {
    console.log("\n── Ceiling probe (one call, N questions) ───────────")
    const ceiling = await probeCeiling()
    for (const probe of ceiling) {
      console.log(
        `N=${String(probe.n).padStart(3)} status=${probe.status} bytes=${probe.bytes}` +
          ` in=${probe.inputTokens} answers=${probe.answers}/${probe.n} latency=${probe.latencyMs}ms`
      )
    }
    console.log(`\nSPIKE_RESULTS ${JSON.stringify({ ceiling, requestTokenBudget: REQUEST_TOKEN_BUDGET }, null, 2)}`)
    return
  }
  const results: ShapeResult[] = []
  const perRow: Record<number, ShapeResult> = {}

  for (const n of [5, 20, 50]) {
    const rows = makeRows(n)
    console.log(`\n── N = ${n} ─────────────────────────────────────────`)
    const onePerRow = await shapeOneCallPerRow(rows)
    const manyQuestions = await shapeOneCallManyQuestions(rows)
    const oneQuestion = await shapeOneCallOneQuestion(rows)
    for (const result of [onePerRow, manyQuestions, oneQuestion]) {
      results.push(result)
      console.log(
        `${result.shape.padEnd(26)} calls=${String(result.calls).padStart(3)}` +
          ` in=${String(result.inputTokens).padStart(6)}` +
          ` out=${String(result.outputTokens).padStart(4)}` +
          ` latency=${String(result.latencyMs).padStart(6)}ms` +
          ` answers=${result.answersReturned}/${n}` +
          ` attributable=${result.attributableRows}/${n}` +
          ` agree-with-per-row=${result.shape === "one-call-per-row" ? "-" : `${agreement(onePerRow, result)}%`}`
      )
    }
    perRow[n] = onePerRow
  }

  console.log("\n── Ceiling probe (one call, N questions) ───────────")
  const ceiling = await probeCeiling()
  for (const probe of ceiling) {
    console.log(
      `N=${String(probe.n).padStart(3)} status=${probe.status} in=${probe.inputTokens} latency=${probe.latencyMs}ms`
    )
  }

  const payload = { results, perRow: Object.values(perRow), ceiling, requestTokenBudget: REQUEST_TOKEN_BUDGET }
  console.log(`\nSPIKE_RESULTS ${JSON.stringify(payload, null, 2)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
