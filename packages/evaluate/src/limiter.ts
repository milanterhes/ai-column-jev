import { NodeRedis } from "@effect/platform-node"
import { DateTime, Duration, Effect, Layer, Option } from "effect"
import { Headers, HttpClientResponse } from "effect/unstable/http"
import * as RateLimiter from "effect/unstable/persistence/RateLimiter"

/**
 * Adaptive rate limiting for the Jev adapter.
 *
 * TypeSafe publishes no rate-limit number, so the limiter has nothing to
 * configure from. The adaptive store treats the limit as a learning problem:
 * while its `inactive`/`learning` phases return no delay at all, each `429`
 * reported through `adaptiveFeedback` — with its `Retry-After` — pushes the
 * key into a cooldown and then into a learned fixed window. `fallbackLimit`
 * and `fallbackWindow` only bound the learning-window TTL; they are a seed,
 * not a claim about the provider.
 *
 * Redis holds that shared state so the web and worker processes learn one
 * budget together. When `REDIS_URL` is absent, or Redis cannot be reached, the
 * in-memory store is used and a warning is logged: the app degrades to a
 * per-process limiter rather than refusing to start.
 */

export const JEV_RATE_LIMIT_KEY = "typesafe/systemone"

const DEFAULT_FALLBACK_LIMIT = 5
const DEFAULT_FALLBACK_WINDOW = Duration.seconds(1)
const REDIS_PREFIX = "jev:ratelimiter:"

const memoryWithWarning = (message: string): Layer.Layer<RateLimiter.RateLimiterStore> =>
  Layer.flatMap(
    Layer.effectDiscard(Effect.logWarning(message)),
    () => RateLimiter.layerStoreMemory
  )

const redisStore = (url: string) =>
  RateLimiter.layerStoreRedis({ prefix: REDIS_PREFIX }).pipe(
    Layer.provide(NodeRedis.layer({ url }))
  )

export const RateLimiterStoreLive: Layer.Layer<RateLimiter.RateLimiterStore> = Layer.unwrap(
  Effect.sync(() => {
    const url = process.env["REDIS_URL"]
    if (url === undefined || url === "") {
      return memoryWithWarning("REDIS_URL is not set; rate limiting uses the in-memory store")
    }
    return redisStore(url).pipe(
      Layer.catch(() =>
        memoryWithWarning("Redis is unreachable; rate limiting uses the in-memory store")
      )
    )
  })
)

export const RateLimiterLive: Layer.Layer<RateLimiter.RateLimiter> = RateLimiter.layer.pipe(
  Layer.provide(RateLimiterStoreLive)
)

/** The delay the provider asked for, either as seconds or as an HTTP date. */
const retryAfter = (
  response: HttpClientResponse.HttpClientResponse
): Duration.Duration | undefined =>
  Option.match(Headers.get(response.headers, "retry-after"), {
    onNone: () => undefined,
    onSome: (value) => {
      const seconds = Number(value)
      if (Number.isFinite(seconds) && seconds >= 0) return Duration.seconds(seconds)
      const at = Date.parse(value)
      if (Number.isNaN(at)) return undefined
      const millis = at - DateTime.toEpochMillis(DateTime.nowUnsafe())
      return millis <= 0 ? Duration.zero : Duration.millis(millis)
    }
  })

const consumeSafely = (
  limiter: RateLimiter.RateLimiter,
  options: RateLimiter.AdaptiveConsumeOptions
): Effect.Effect<RateLimiter.AdaptiveConsumeResult | null> =>
  limiter.adaptiveConsume(options).pipe(
    Effect.catch(() =>
      Effect.logWarning("rate limiter unavailable; sending without an adaptive delay").pipe(
        Effect.as(null)
      )
    )
  )

const feedbackSafely = (
  limiter: RateLimiter.RateLimiter,
  options: RateLimiter.AdaptiveFeedbackOptions
): Effect.Effect<void> =>
  limiter.adaptiveFeedback(options).pipe(
    Effect.catch(() =>
      Effect.logWarning("rate limiter feedback unavailable; adaptive state not updated")
    )
  )

export interface AdaptiveRequestOptions {
  readonly key: string
  readonly tokens?: number
  readonly fallbackLimit?: number
  readonly fallbackWindow?: Duration.Input
}

/**
 * Wraps one request so it waits out the limiter's delay before sending, then
 * reports the response status and `Retry-After` back to the adaptive store.
 *
 * A limiter failure never fails the request: without Redis the call proceeds
 * unthrottled, which is the correct degradation for an unknown limit.
 */
export const withAdaptiveRateLimit = <E, R>(
  limiter: RateLimiter.RateLimiter,
  request: Effect.Effect<HttpClientResponse.HttpClientResponse, E, R>,
  options: AdaptiveRequestOptions
): Effect.Effect<HttpClientResponse.HttpClientResponse, E, R> =>
  Effect.gen(function*() {
    const tokens = options.tokens ?? 1

    const ticket = yield* consumeSafely(limiter, {
      key: options.key,
      tokens,
      fallbackLimit: options.fallbackLimit ?? DEFAULT_FALLBACK_LIMIT,
      fallbackWindow: Duration.fromInputUnsafe(options.fallbackWindow ?? DEFAULT_FALLBACK_WINDOW)
    })

    if (ticket !== null && Duration.isGreaterThan(ticket.delay, Duration.zero)) {
      yield* Effect.sleep(ticket.delay)
    }

    const response = yield* request

    yield* feedbackSafely(limiter, {
      key: options.key,
      epoch: ticket?.epoch ?? 0,
      tokens,
      status: response.status,
      retryAfter: retryAfter(response)
    })

    return response
  })
