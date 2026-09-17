/**
 * The evaluation core: pure functions and types for turning an AI column plus
 * a row into a decision request, and turning the provider's response back into
 * a Result.
 *
 * Deliberately dependency-free and side-effect-free so it can be tested and
 * verified in isolation. The Effect service in `./service.ts` wraps it.
 *
 * Shapes here are not guesses: they were verified against the live
 * `https://api.typesafe.ai/v1/systemone` endpoint. In particular `choice`
 * requires `criteria` as a **label -> description map** (sending `options`
 * returns 422), and `score` requires `criteria` as an **ordered array** of
 * level descriptions.
 */

export type ColumnType = "yes_no" | "category" | "score"

export interface Label {
  readonly name: string
  readonly description?: string | undefined
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
  /** The winner's share, computed by us. Null when there is no answer. */
  readonly confidence: number | null
  /** Jev's own `confidence`, kept for later comparison. Null when absent. */
  readonly providerConfidence: number | null
  /**
   * The Noul sufficiency probability, 0..1. **This is the only graded
   * uncertainty Jev actually emits** — its judgment distributions are peaked by
   * design, so `confidence` is empirically near 1 for every row it judges. See
   * `FINDINGS.md`. Null when the sufficiency question was not answered.
   */
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
 * content (0.37 and up). A gate at 0.5 discarded real rows — an invoice bug
 * scoring 0.49 was thrown away. 0.3 sits in the empty gap.
 *
 * Re-measure before trusting this on a different corpus.
 */
export const SUFFICIENCY_MIN = 0.3

export const DEFAULT_NEEDS_REVIEW_THRESHOLD = 0.8

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * Render a whole row into Jev's `state`. The spec sends the entire row: the
 * instruction may reference any column, and a narrower rule would be a guess
 * that can silently change a judgment.
 */
export const renderState = (row: Readonly<Record<string, unknown>>): string =>
  Object.entries(row)
    .map(([key, value]) => `${key}: ${value === null || value === undefined ? "" : String(value)}`)
    .join("\n")

const sufficiencyInstruction = (instruction: string): string =>
  `Is there enough information here to answer the following question? ${instruction}`

export interface JevRequest {
  readonly state: string
  readonly model: string
  readonly questions: Record<string, unknown>
}

export const buildRequest = (
  column: AiColumn,
  row: Readonly<Record<string, unknown>>,
  model = "jev-latest"
): JevRequest => {
  const judgment = column.type === "score"
    ? {
        type: "score",
        instructions: column.instruction,
        // Score criteria are an ORDERED array of level descriptions.
        criteria: column.labels.map((label) => label.name)
      }
    : {
        type: "choice",
        instructions: column.instruction,
        // Choice criteria are a MAP of label -> description.
        criteria: Object.fromEntries(
          column.labels.map((label) => [label.name, label.description ?? label.name])
        )
      }

  return {
    state: renderState(row),
    model,
    questions: {
      [JUDGMENT_ID]: judgment,
      [SUFFICIENCY_ID]: {
        type: "noul",
        instructions: sufficiencyInstruction(column.instruction)
      }
    }
  }
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
 * Turn a provider response into a Result.
 *
 * - A sufficiency answer below `SUFFICIENCY_MIN` means the row is
 *   `unable_to_determine` and **the judgment is discarded** — never surfaced as
 *   a value, per the decision "What confidence means".
 * - Confidence is the **winner's share**, computed by us, not Jev's own
 *   `confidence` (which is still recorded for later comparison).
 */
export const parseResponse = (
  column: AiColumn,
  response: JevResponse,
  threshold = column.needsReviewThreshold
): EvaluationResult => {
  const usage = {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0
  }

  const answers = response.answers ?? {}
  const judgment = answers[JUDGMENT_ID]
  const sufficiency = answers[SUFFICIENCY_ID]

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

  if (judgment.type === "score") {
    // Score probabilities are keyed by level INDEX; our labels are that order.
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
