/**
 * The evaluation core: pure functions and types for turning an AI column plus
 * a row into a decision request, and turning the provider's response back into
 * a Result.
 *
 * Deliberately dependency-free and side-effect-free so it can be tested and
 * verified in isolation. The Effect service in `./service.ts` wraps it.
 *
 * Two things here are the difference between a vague question and a specified
 * one, and both are documented in the TypeSafe docs:
 *
 * 1. **Structured criteria.** Choice options and Noul branches accept an object
 *    with `what`, `not_for` and `examples`. Defining what an answer means — and
 *    what it is *not for* — is what stops "the row contains no feature request"
 *    from reading as "I cannot tell".
 * 2. **Decomposed state.** The row is sent as a structured object, and each
 *    question names the fields it inspects, so a question is never confused
 *    about which part of the row it is judging.
 */

export type ColumnType = "yes_no" | "category" | "score"

export interface Label {
  readonly name: string
  /** Plain description. Used when the structured fields below are absent. */
  readonly description?: string | undefined
  /** What belongs in this option. */
  readonly what?: string | undefined
  /** What belongs in a neighbouring option instead. */
  readonly notFor?: string | undefined
  /** Representative rows. This is the few-shot channel. */
  readonly examples?: ReadonlyArray<string> | undefined
  /** Score levels only: observable signals of this level. */
  readonly signals?: ReadonlyArray<string> | undefined
}

/** A user-facing AI column. One shape for all three types. */
export interface AiColumn {
  readonly type: ColumnType
  readonly instruction: string
  readonly labels: ReadonlyArray<Label>
  readonly needsReviewThreshold: number
}

export type ResultStatus = "high_confidence" | "needs_review" | "unable_to_determine" | "failed"

export interface DistributionEntry {
  readonly label: string
  readonly probability: number
}

export interface EvaluationResult {
  /** A label name, or null when the row could not be judged. */
  readonly selectedValue: string | null
  /** Our confidence measure. Null when there is no answer. */
  readonly confidence: number | null
  /** Jev's own `confidence`, kept for later comparison. Null when absent. */
  readonly providerConfidence: number | null
  /** The Noul sufficiency probability, 0..1. */
  readonly sufficiency: number | null
  readonly status: ResultStatus
  readonly distribution: ReadonlyArray<DistributionEntry>
  /** Type-specific extras. Score carries Jev's probability-weighted index. */
  readonly detail: { readonly fractionalScore?: number } | null
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number } | null
}

export const JUDGMENT_ID = "judgment"
export const SUFFICIENCY_ID = "sufficiency"

/**
 * The Noul sufficiency answer must reach this to count as "we could judge it".
 * Below it the row is `unable_to_determine` and the judgment is discarded.
 *
 * **Calibrated against real output, not chosen.** Jev is systematically
 * under-confident on this question: over 35 support tickets it never returned
 * more than ~0.97 and put rich, plainly judgeable messages in the 0.4–0.8 band.
 * The clean separation in that sample is between genuinely unusable rows
 * (`"help"` 0.08, `" "` 0.06, `"The sync is broken."` 0.20) and ordinary
 * content (0.37 and up). A gate at 0.5 discarded real rows. 0.3 sits in the gap.
 *
 * Re-measure before trusting this on a different corpus.
 */
export const SUFFICIENCY_MIN = 0.3

/**
 * Thresholds are per primitive, because the confidence scales are not the same
 * shape. A Noul's confidence is a probability of the selected answer (0.5–1.0),
 * so its floor sits close to a coin flip. A Choice or Score's confidence is a
 * winner's share (0–1.0), where a low value means genuinely split options.
 */
export const DEFAULT_NEEDS_REVIEW_THRESHOLD = 0.8
export const DEFAULT_YES_NO_THRESHOLD = 0.6

export const defaultThresholdFor = (type: ColumnType): number =>
  type === "yes_no" ? DEFAULT_YES_NO_THRESHOLD : DEFAULT_NEEDS_REVIEW_THRESHOLD

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * Render a whole row for the `state`. Structure is preferred over a flattened
 * string: the docs are explicit that a row is already JSON and that
 * serialising it into a string template throws away the labels the model could
 * have used to tell fields apart.
 */
export const renderState = (row: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[key] = value === null || value === undefined ? "" : value
  }
  return out
}

/**
 * Tell the model which fields the question is about. With a prefix, the fields
 * live inside a batched state and are addressed as `rows[7].message` — the
 * backticked dot-and-index paths the docs prescribe.
 */
const inspectHint = (keys: ReadonlyArray<string>, prefix?: string): string =>
  keys.length === 0
    ? ""
    : keys.map((key) => (prefix === undefined ? `\`${key}\`` : `\`${prefix}.${key}\``)).join(", ")

const instructions = (
  question: string,
  keys: ReadonlyArray<string>,
  prefix?: string
): Record<string, unknown> => {
  const inspect = inspectHint(keys, prefix)
  return inspect === "" ? { question } : { question, inspect }
}

/** A Choice option, or a Noul branch. `not_for` is where the boundary lives. */
const optionCriteria = (label: Label) => ({
  what: label.what ?? label.description ?? label.name,
  ...(label.notFor === undefined ? {} : { not_for: label.notFor }),
  ...(label.examples === undefined || label.examples.length === 0
    ? {}
    : { examples: [...label.examples] })
})

export interface JevRequest {
  readonly state: Record<string, unknown>
  readonly model: string
  readonly questions: Record<string, unknown>
}

/**
 * Build the judgment question for a column.
 *
 * **Yes/No uses Noul, not a two-option Choice.** A binary Choice collapses to a
 * near-certain distribution — every judged row in the sample returned 0.96–1.00
 * — so a threshold on it can never fire and `needs_review` is unreachable for
 * the most common column type. Noul returns a graded probability on the same
 * rows (0.58, 0.44, 0.09), which is the signal the review queue needs.
 */
const judgmentQuestion = (
  column: AiColumn,
  keys: ReadonlyArray<string>,
  prefix?: string
): Record<string, unknown> => {
  const [first, second] = column.labels

  if (column.type === "yes_no") {
    return {
      type: "noul",
      instructions: instructions(column.instruction, keys, prefix),
      criteria: {
        true: optionCriteria(first ?? { name: "Yes" }),
        false: optionCriteria(second ?? { name: "No" })
      }
    }
  }

  if (column.type === "score") {
    return {
      type: "score",
      instructions: instructions(column.instruction, keys, prefix),
      criteria: column.labels.map((label) => ({
        summary: label.name,
        ...(label.what === undefined && label.description === undefined
          ? {}
          : { what: label.what ?? label.description }),
        ...(label.signals === undefined ? {} : { signals: [...label.signals] })
      }))
    }
  }

  return {
    type: "choice",
    instructions: instructions(column.instruction, keys, prefix),
    criteria: Object.fromEntries(column.labels.map((label) => [label.name, optionCriteria(label)]))
  }
}

/**
 * The sufficiency check. Structured for the same reason as the judgment: the
 * `false` branch says explicitly that an absence of something is a defined
 * answer, not an unknown.
 */
const sufficiencyQuestion = (
  column: AiColumn,
  keys: ReadonlyArray<string>,
  prefix?: string
): Record<string, unknown> => ({
  type: "noul",
  instructions: {
    question: `Does the state contain what is needed to answer the question below?`,
    question_under_test: column.instruction,
    note: "Judge whether the relevant content is present and specific enough. Do not judge the answer itself.",
    ...(inspectHint(keys, prefix) === "" ? {} : { inspect: inspectHint(keys, prefix) })
  },
  criteria: {
    true: {
      what:
        "The state contains the content the question needs — enough to give a definite answer, even if that answer is negative",
      examples: ["A specific description of what the customer wants or what is broken"]
    },
    false: {
      what: "The content the question needs is absent, empty, or too vague to judge",
      not_for:
        "A row that plainly contains no instance of the thing asked about is NOT missing information — that is a definite negative answer",
      examples: ["An empty message", "A single word such as 'help'", "Placeholder text with no substance"]
    }
  }
})

export const buildRequest = (
  column: AiColumn,
  row: Readonly<Record<string, unknown>>,
  model = "jev-latest"
): JevRequest => ({
  state: renderState(row),
  model,
  questions: {
    [JUDGMENT_ID]: judgmentQuestion(column, Object.keys(row)),
    [SUFFICIENCY_ID]: sufficiencyQuestion(column, Object.keys(row))
  }
})

/**
 * One request carrying many rows, with one question pair per row.
 *
 * Measured on 50 real rows: 50 separate calls cost 24,165 input tokens and
 * 14.2 seconds; this shape costs 13,429 tokens and 0.36 seconds, with answers
 * attributable back to each row and 100% agreement. Proven to N=200.
 *
 * The state is an array and each question addresses its own row by index, which
 * is why the docs' backticked path syntax matters here.
 */
export const BATCH_CHUNK_SIZE = 100

export interface BatchRow {
  readonly id: string
  readonly data: Readonly<Record<string, unknown>>
}

export const batchJudgmentId = (rowId: string): string => `j:${rowId}`
export const batchSufficiencyId = (rowId: string): string => `s:${rowId}`

export const buildBatchRequest = (
  column: AiColumn,
  rows: ReadonlyArray<BatchRow>,
  model = "jev-latest"
): JevRequest => {
  const questions: Record<string, unknown> = {}
  rows.forEach((row, index) => {
    const keys = Object.keys(row.data)
    const prefix = `rows[${index}]`
    questions[batchJudgmentId(row.id)] = judgmentQuestion(column, keys, prefix)
    questions[batchSufficiencyId(row.id)] = sufficiencyQuestion(column, keys, prefix)
  })

  return {
    state: { rows: rows.map((row) => ({ id: row.id, ...renderState(row.data) })) },
    model,
    questions
  }
}

/**
 * Split a batch response back out to rows. A row with no answer at all is a
 * failure, not a silent skip — the caller must be able to tell the difference.
 */
export const parseBatchResponse = (
  column: AiColumn,
  response: JevResponse,
  rows: ReadonlyArray<BatchRow>,
  threshold = column.needsReviewThreshold
): Map<string, EvaluationResult> => {
  const answers = response.answers ?? {}
  const usage = {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0
  }
  const out = new Map<string, EvaluationResult>()
  for (const row of rows) {
    const judgment = answers[batchJudgmentId(row.id)]
    const sufficiency = answers[batchSufficiencyId(row.id)]
    if (judgment === undefined && sufficiency === undefined) {
      out.set(row.id, failedResult("no answer returned for this row"))
      continue
    }
    out.set(row.id, resultFrom(column, judgment, sufficiency, threshold, usage))
  }
  return out
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

interface JevAnswer {
  readonly type?: string
  readonly choice?: string
  readonly confidence?: number
  readonly probabilities?: Record<string, number>
  readonly score?: number
  readonly legend?: Record<string, string>
  readonly noul?: number
}

export interface JevResponse {
  readonly model?: string
  readonly answers?: Record<string, JevAnswer>
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number }
}

/** The trimmed projection we persist: the answers subtree plus usage. */
export const trimProviderResponse = (
  response: JevResponse
): { readonly answers: Record<string, JevAnswer>; readonly usage: unknown } => ({
  answers: response.answers ?? {},
  usage: response.usage ?? null
})

const toDistribution = (probabilities: Record<string, number> | undefined): DistributionEntry[] =>
  Object.entries(probabilities ?? {})
    .map(([label, probability]) => ({ label, probability }))
    .sort((a, b) => b.probability - a.probability)

const winnerShare = (distribution: ReadonlyArray<DistributionEntry>): number | null =>
  distribution.length === 0 ? null : distribution[0]!.probability

/**
 * Confidence for a Noul: **the probability of the answer we selected.**
 *
 * Not `|p − 0.5| × 2`. Measured on 27 real rows, Jev's Noul probability is
 * compressed toward 0.5 — it returned 0.65 for "Please add a Slack
 * integration", an unmistakable yes. Squeezing that into 0..1 produced "30%
 * confident" on the clearest positive in the set, which both reads as alarming
 * and makes a 0.8 threshold flag 41% of rows.
 *
 * The selected answer's probability runs 0.5–1.0, reads naturally ("Yes 65%"),
 * and — measured on the same rows — separates the one model error (0.52) from
 * every correct answer (0.61 and up).
 */
export const noulConfidence = (p: number, selectedIsYes: boolean): number =>
  selectedIsYes ? p : 1 - p

/**
 * Turn a provider response into a Result.
 *
 * - A sufficiency answer below `SUFFICIENCY_MIN` means the row is
 *   `unable_to_determine` and **the judgment is discarded**.
 * - Confidence is our own measure, not Jev's (which is still recorded).
 */
export const parseResponse = (
  column: AiColumn,
  response: JevResponse,
  threshold = column.needsReviewThreshold
): EvaluationResult =>
  resultFrom(
    column,
    (response.answers ?? {})[JUDGMENT_ID],
    (response.answers ?? {})[SUFFICIENCY_ID],
    threshold,
    {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0
    }
  )

/** Shared by the single-row and batched paths so they cannot drift apart. */
const resultFrom = (
  column: AiColumn,
  judgment: JevAnswer | undefined,
  sufficiency: JevAnswer | undefined,
  threshold: number,
  usage: { readonly inputTokens: number; readonly outputTokens: number }
): EvaluationResult => {
  const unable = (): EvaluationResult => ({
    selectedValue: null,
    confidence: null,
    providerConfidence: judgment?.confidence ?? null,
    sufficiency: sufficiency?.noul ?? null,
    status: "unable_to_determine",
    distribution: [],
    detail: null,
    usage
  })

  if (sufficiency === undefined || (sufficiency.noul ?? 1) < SUFFICIENCY_MIN) return unable()
  if (judgment === undefined) return unable()

  // ── Yes/No via Noul ───────────────────────────────────────────────────────
  if (judgment.type === "noul") {
    const p = judgment.noul ?? 0.5
    const yes = column.labels[0]?.name ?? "Yes"
    const no = column.labels[1]?.name ?? "No"
    const selectedIsYes = p >= 0.5
    const confidence = noulConfidence(p, selectedIsYes)
    return {
      selectedValue: selectedIsYes ? yes : no,
      confidence,
      providerConfidence: judgment.confidence ?? null,
      sufficiency: sufficiency.noul ?? null,
      status: confidence >= threshold ? "high_confidence" : "needs_review",
      distribution: [
        { label: yes, probability: p },
        { label: no, probability: 1 - p }
      ].sort((a, b) => b.probability - a.probability),
      detail: null,
      usage
    }
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  if (judgment.type === "score") {
    const byIndex = Object.entries(judgment.probabilities ?? {}).map(([index, probability]) => {
      const position = Number(index)
      const label = column.labels[position]?.name ?? judgment.legend?.[index] ?? index
      return { label, probability, position }
    })
    const distribution = byIndex
      .map(({ label, probability }) => ({ label, probability }))
      .sort((a, b) => b.probability - a.probability)
    const selected = byIndex.slice().sort((a, b) => b.probability - a.probability)[0]
    const confidence = winnerShare(distribution) ?? 0
    return {
      selectedValue: selected?.label ?? null,
      confidence,
      providerConfidence: judgment.confidence ?? null,
      sufficiency: sufficiency.noul ?? null,
      status: confidence >= threshold ? "high_confidence" : "needs_review",
      distribution,
      detail: judgment.score === undefined ? null : { fractionalScore: judgment.score },
      usage
    }
  }

  // ── Category via Choice ───────────────────────────────────────────────────
  const distribution = toDistribution(judgment.probabilities)
  const confidence = winnerShare(distribution) ?? 0
  const selected = judgment.choice ?? distribution[0]?.label ?? null
  return {
    selectedValue: selected,
    confidence,
    providerConfidence: judgment.confidence ?? null,
    sufficiency: sufficiency.noul ?? null,
    status: confidence >= threshold ? "high_confidence" : "needs_review",
    distribution,
    detail: null,
    usage
  }
}

/**
 * A terminal failure — a `422` or `401`, or a row that could never be judged.
 * The caller persists this and treats the work item as **succeeded**, so it
 * burns no retry attempt.
 */
export const failedResult = (message: string): EvaluationResult & { readonly error: string } => ({
  selectedValue: null,
  confidence: null,
  providerConfidence: null,
  sufficiency: null,
  status: "failed",
  distribution: [],
  detail: null,
  usage: null,
  error: message
})

/** Effective value: a human's correction wins over the model's answer. */
export const effectiveValue = (
  result: Pick<EvaluationResult, "selectedValue">,
  correction: string | null
): string | null => correction ?? result.selectedValue
