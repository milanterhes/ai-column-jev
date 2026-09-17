import { Duration, Effect } from "effect"
import { EvaluationError, EvaluationService } from "@app/evaluate"
import type { AiColumn as EvaluationColumn, EvaluatedRow } from "@app/evaluate"
import { listQuestions, upsertResult } from "@app/spreadsheet/repo"
import { SqlClient, SqlError } from "effect/unstable/sql"
import type { QueueConfigShape } from "./config.ts"
import * as repo from "./repo.ts"
import type { WorkItem } from "./work.ts"

export interface RowHandler<E = never, R = never> {
  readonly handle: (work: WorkItem, attempt: number) => Effect.Effect<void, E, R>
}

const toEvaluationColumn = (column: repo.WorkColumn): EvaluationColumn => ({
  type: column.type,
  instruction: column.instruction,
  labels: column.labels,
  needsReviewThreshold: column.needs_review_threshold
})

type RowOutcome =
  | { readonly _tag: "evaluated"; readonly evaluated: EvaluatedRow }
  | { readonly _tag: "failed"; readonly reason: string }

/**
 * Exponential with a cap. A `Retry-After` would take precedence here if the
 * evaluation boundary surfaced one; it currently does not, so the delay is
 * derived from the attempt alone. The sleep is held inside the worker slot on
 * purpose: under an unknown provider limit, slowing the runner down is the
 * backpressure we want, not a hack.
 */
const backoffFor = (config: QueueConfigShape, attempt: number): Duration.Duration =>
  Duration.millis(Math.min(config.backoffMaxMillis, config.backoffBaseMillis * 2 ** attempt))

/**
 * The retryable/terminal split lives here.
 *
 * Terminal failures write a failed Result and *succeed*, so they burn no
 * attempt. Retryable failures sleep, then fail, which lets the queue push the
 * item back and the next attempt arrive after the backoff. On the final
 * attempt a retryable failure is recorded as failed and succeeds too, so the
 * row reaches a terminal state and progress can complete.
 */
export const handleRow = (
  config: QueueConfigShape,
  work: WorkItem,
  attempt: number
): Effect.Effect<void, EvaluationError | SqlError.SqlError, EvaluationService | SqlClient.SqlClient> =>
  Effect.gen(function*() {
    // Cancellation is the handler's first act: in-flight rows finish, every
    // remaining item no-ops quickly. A missing run means the column was deleted
    // mid-flight, which cascades the run away; there is nothing left to fail.
    if (work.runId !== null) {
      const run = yield* repo.findRun(work.runId)
      if (run === null || run.cancelled || run.status !== "running") return
    }

    const column = yield* repo.findWorkColumn(work.aiColumnId)
    if (column === null) {
      if (work.runId !== null) yield* repo.markRunFailed(work.runId)
      return
    }

    const evaluator = yield* EvaluationService
    const extras = (yield* listQuestions(column.id)).map((question) => ({
      key: question.key,
      type: question.type,
      instruction: question.instruction,
      labels: question.labels
    }))

    // A chunk: build one request for every row in it, then fan the answers
    // back out. Terminal failures are written per row, and a chunk that fails
    // outright fails whole — the queue retries it.
    if (work.rowIds.length > 1) {
      const chunk = yield* repo.findWorkRows(work.rowIds)
      if (chunk.length === 0) return

      const results = yield* evaluator
        .evaluateMany(toEvaluationColumn(column), chunk, extras)
        .pipe(
          Effect.catchIf(
            (error): error is EvaluationError => error instanceof EvaluationError,
            (error): Effect.Effect<ReadonlyMap<string, EvaluatedRow>, EvaluationError> =>
              error.retryable && attempt + 1 < config.maxAttempts
                ? Effect.sleep(backoffFor(config, attempt)).pipe(Effect.andThen(Effect.fail(error)))
                : Effect.succeed(new Map<string, EvaluatedRow>())
          )
        )

      yield* Effect.forEach(
        chunk,
        (row) => {
          const evaluated = results.get(row.id)
          return upsertResult({
            aiColumnId: column.id,
            rowId: row.id,
            selectedValue: evaluated?.result.selectedValue ?? null,
            confidence: evaluated?.result.confidence ?? null,
            providerConfidence: evaluated?.result.providerConfidence ?? null,
            sufficiency: evaluated?.result.sufficiency ?? null,
            status: evaluated?.result.status ?? "failed",
            criteriaVersion: column.criteria_version,
            answers: evaluated?.answers ?? null,
            detail: evaluated?.result.detail ?? null,
            providerResponse: evaluated?.providerResponse ?? { error: "no answer in batch" }
          })
        },
        { discard: true }
      )
      return
    }

    const row = yield* repo.findWorkRow(work.rowId)
    if (row === null) return

    const outcome = yield* evaluator.evaluate(toEvaluationColumn(column), row.data, extras).pipe(
      Effect.map((evaluated): RowOutcome => ({ _tag: "evaluated", evaluated })),
      Effect.catchIf(
        (error): error is EvaluationError => error instanceof EvaluationError,
        (error): Effect.Effect<RowOutcome, EvaluationError> =>
          error.retryable && attempt + 1 < config.maxAttempts
            ? Effect.sleep(backoffFor(config, attempt)).pipe(Effect.andThen(Effect.fail(error)))
            : Effect.succeed({ _tag: "failed", reason: error.reason })
      )
    )

    if (outcome._tag === "failed") {
      yield* upsertResult({
        aiColumnId: column.id,
        rowId: work.rowId,
        selectedValue: null,
        confidence: null,
        providerConfidence: null,
        sufficiency: null,
        status: "failed",
        criteriaVersion: column.criteria_version,
        answers: null,
        detail: null,
        providerResponse: { error: outcome.reason }
      })
      return
    }

    const { result, providerResponse } = outcome.evaluated
    yield* upsertResult({
      aiColumnId: column.id,
      rowId: work.rowId,
      selectedValue: result.selectedValue,
      confidence: result.confidence,
      providerConfidence: result.providerConfidence,
      sufficiency: result.sufficiency,
      status: result.status,
      criteriaVersion: column.criteria_version,
      answers: outcome.evaluated.answers,
      detail: result.detail,
      providerResponse
    })
  })
