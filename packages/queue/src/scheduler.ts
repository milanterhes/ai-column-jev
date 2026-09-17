import { Effect, Exit, Option, Ref, Scope } from "effect"
import * as Schema from "effect/Schema"
import * as PersistedQueue from "effect/unstable/persistence/PersistedQueue"
import { QueueConfig } from "./config.ts"
import type { QueueConfigShape } from "./config.ts"
import { QueueDirectory } from "./directory.ts"
import type { RowHandler } from "./handler.ts"
import { WorkItem, queueKindOf, type WorkKind } from "./work.ts"

const decodeWorkItemOption = Schema.decodeUnknownOption(WorkItem)

type ClaimedItem = {
  readonly id: string
  readonly attempts: number
  readonly element: unknown
}

type ActiveQueues = Record<WorkKind, ReadonlyArray<string>>

/**
 * Claim one item from a named queue, bounded.
 *
 * `PersistedQueue`'s own `take` runs the handler inside the same effect that
 * claims, so a timeout around it would also time out the handler. The store's
 * lower-level `take` separates the two: the claim is scoped, and the handler
 * runs after, with the scope closed on the handler's exit so the store
 * completes or retries according to it. That is what makes a bounded
 * round-robin claim possible without cutting a slow evaluation short.
 *
 * Returns whether an item was claimed and its handler finished.
 */
const attemptClaim = <E, R>(
  store: PersistedQueue.PersistedQueueStore["Service"],
  config: QueueConfigShape,
  handler: RowHandler<E, R>,
  name: string
): Effect.Effect<boolean, never, R> =>
  Effect.scoped(
    Effect.gen(function*() {
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer((exit) => Scope.close(scope, exit))

      const claimed = yield* store
        .take({ name, maxAttempts: config.maxAttempts })
        .pipe(
          Scope.provide(scope),
          Effect.timeoutOption(config.claimTimeoutMillis),
          Effect.catchCause(() =>
            Effect.logWarning("queue claim failed").pipe(Effect.as(Option.none<ClaimedItem>()))
          )
        )

      if (Option.isNone(claimed)) return false

      const item = claimed.value
      const work = decodeWorkItemOption(item.element)
      if (Option.isNone(work)) {
        yield* Scope.close(scope, Exit.void)
        yield* Effect.logWarning("dropping malformed queue item", { id: item.id })
        return true
      }

      const exit = yield* Effect.exit(handler.handle(work.value, item.attempts))
      yield* Scope.close(scope, exit)
      if (Exit.isFailure(exit)) {
        yield* Effect.logWarning("queue item failed", { id: item.id, attempts: item.attempts })
      }
      return true
    })
  )

const runSlot = <E, R>(
  store: PersistedQueue.PersistedQueueStore["Service"],
  config: QueueConfigShape,
  handler: RowHandler<E, R>,
  kind: WorkKind,
  active: Ref.Ref<ActiveQueues>,
  cursor: Ref.Ref<number>
): Effect.Effect<void, never, R> =>
  Effect.gen(function*() {
    while (true) {
      const queues = (yield* Ref.get(active))[kind]
      let handled = false
      let position = 0
      while (position < queues.length && !handled) {
        const name = yield* Ref.modify(cursor, (index) => [
          queues[index % queues.length]!,
          index + 1
        ])
        position += 1
        handled = yield* attemptClaim(store, config, handler, name)
      }
      if (!handled) yield* Effect.sleep(config.idlePollMillis)
    }
  })

const startSlots = <E, R>(
  store: PersistedQueue.PersistedQueueStore["Service"],
  config: QueueConfigShape,
  handler: RowHandler<E, R>,
  kind: WorkKind,
  count: number,
  active: Ref.Ref<ActiveQueues>,
  cursor: Ref.Ref<number>
): Effect.Effect<void, never, R> =>
  Effect.forEach(
    Array.from({ length: count }, (_, index) => index),
    () => runSlot(store, config, handler, kind, active, cursor).pipe(Effect.forkChild, Effect.asVoid),
    { discard: true }
  )

const refreshLoop = (active: Ref.Ref<ActiveQueues>): Effect.Effect<void, never, QueueConfig | QueueDirectory> =>
  Effect.gen(function*() {
    const config = yield* QueueConfig
    const directory = yield* QueueDirectory
    while (true) {
      const names = yield* directory.active.pipe(
        Effect.catchCause(() => Effect.succeed<ReadonlyArray<string>>([]))
      )
      yield* Ref.set(active, {
        bulk: names.filter((name) => queueKindOf(name) === "bulk"),
        interactive: names.filter((name) => queueKindOf(name) === "interactive")
      })
      yield* Effect.sleep(config.activeRefreshMillis)
    }
  })

/**
 * The round-robin claim loop. Each free slot takes the next active user queue
 * in turn, so a user with a thousand rows cannot monopolise a pass. Interactive
 * and bulk slots draw from disjoint queues, which reserves interactive capacity
 * rather than merely hoping for it.
 */
export const runWorkerWith = <E, R>(
  handler: RowHandler<E, R>
): Effect.Effect<
  void,
  never,
  PersistedQueue.PersistedQueueStore | QueueConfig | QueueDirectory | R
> =>
  Effect.gen(function*() {
    const config = yield* QueueConfig
    const store = yield* PersistedQueue.PersistedQueueStore
    const active = yield* Ref.make<ActiveQueues>({ bulk: [], interactive: [] })
    const interactiveCursor = yield* Ref.make(0)
    const bulkCursor = yield* Ref.make(0)

    yield* refreshLoop(active).pipe(Effect.forkChild)
    yield* startSlots(
      store,
      config,
      handler,
      "interactive",
      config.interactiveConcurrency,
      active,
      interactiveCursor
    )
    yield* startSlots(store, config, handler, "bulk", config.bulkConcurrency, active, bulkCursor)
    yield* Effect.never
  })
