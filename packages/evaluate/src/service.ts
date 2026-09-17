import { Context, Duration, Effect, Layer, Schedule } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import {
  buildRequest,
  failedResult,
  parseResponse,
  trimProviderResponse,
  type AiColumn,
  type EvaluationResult
} from "./core.ts"

/**
 * The evaluation service: the seam between the app and Jev.
 *
 * It takes a row's **content plus a column definition, never a row id**, so a
 * future connector-driven product can hand it rows from a live sheet without
 * this being rewritten. See the decision "The evaluation-service boundary".
 *
 * The wire contract lives in `core.ts` and was verified against the live API.
 */

export class EvaluationError extends Error {
  readonly _tag = "EvaluationError" as const
  readonly reason: string
  readonly retryable: boolean
  readonly status: number | undefined

  constructor(reason: string, retryable: boolean, status?: number) {
    super(reason)
    this.reason = reason
    this.retryable = retryable
    this.status = status
  }
}

export interface EvaluatedRow {
  readonly result: EvaluationResult
  /** The trimmed provider response we persist for debugging. */
  readonly providerResponse: unknown
  readonly model: string
}

export interface EvaluationServiceShape {
  readonly evaluate: (
    column: AiColumn,
    row: Readonly<Record<string, unknown>>
  ) => Effect.Effect<EvaluatedRow, EvaluationError>
}

export class EvaluationService extends Context.Service<EvaluationService, EvaluationServiceShape>()(
  "@app/evaluate/EvaluationService"
) {}

export interface JevConfigShape {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
}

export class JevConfig extends Context.Service<JevConfig, JevConfigShape>()("@app/evaluate/JevConfig") {}

/**
 * Provider failures that mean "never retry this row" — the request itself was
 * rejected, so sending it again produces the same rejection.
 */
const isTerminal = (status: number): boolean => status === 401 || status === 422

const endpoint = (baseUrl: string): string => `${baseUrl.replace(/\/+$/, "")}/v1/systemone`

interface Attempt {
  readonly status: number
  readonly json: unknown
}

const MAX_RETRIES = 3

export const EvaluationServiceLive: Layer.Layer<
  EvaluationService,
  never,
  JevConfig | HttpClient.HttpClient
> = Layer.effect(
  EvaluationService,
  Effect.gen(function*() {
    const config = yield* JevConfig
    // Captured at construction so the method carries no client requirement.
    const client = yield* HttpClient.HttpClient
    const url = endpoint(config.baseUrl)

    const callOnce = (payload: unknown): Effect.Effect<Attempt, EvaluationError> =>
      Effect.gen(function*() {
        const request = HttpClientRequest.post(url).pipe(
          HttpClientRequest.setHeader("authorization", `Bearer ${config.apiKey}`),
          HttpClientRequest.setHeader("content-type", "application/json"),
          HttpClientRequest.bodyJsonUnsafe(payload)
        )

        const response = yield* client
          .execute(request)
          .pipe(Effect.mapError(() => new EvaluationError("transport failure", true)))

        const status = response.status

        // Terminal — handed back as a value, never as a retryable failure.
        if (isTerminal(status)) return { status, json: null }

        if (status === 429 || status === 529 || status >= 500) {
          return yield* Effect.fail(new EvaluationError("provider unavailable", true, status))
        }
        if (status < 200 || status >= 300) {
          return yield* Effect.fail(new EvaluationError("unexpected provider status", false, status))
        }

        const json = yield* response.json.pipe(
          Effect.mapError(() => new EvaluationError("unreadable provider response", true, status))
        )
        return { status, json }
      })

    const evaluate: EvaluationServiceShape["evaluate"] = (column: AiColumn, row) =>
      callOnce(buildRequest(column, row, config.model)).pipe(
        // Back off on transient provider failures; the schedule is capped so a
        // row cannot occupy a worker slot indefinitely.
        Effect.retry({
          schedule: Schedule.exponential(Duration.millis(500)),
          times: MAX_RETRIES
        }),
        Effect.map((attempt): EvaluatedRow => {
          if (isTerminal(attempt.status)) {
            return {
              result: failedResult(`provider rejected the request (HTTP ${attempt.status})`),
              providerResponse: null,
              model: config.model
            }
          }
          return {
            result: parseResponse(column, attempt.json as never),
            providerResponse: trimProviderResponse(attempt.json as never),
            model: config.model
          }
        })
      )

    return { evaluate }
  })
)
