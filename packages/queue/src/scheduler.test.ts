import { describe, expect, it } from "vitest"
import { Duration, Effect, Fiber, Layer, Ref } from "effect"
import * as PersistedQueue from "effect/unstable/persistence/PersistedQueue"
import { QueueConfig, defaultQueueConfig } from "./config.ts"
import { QueueDirectory } from "./directory.ts"
import { runWorkerWith } from "./scheduler.ts"
import { WorkItem, queueKindOf, queueName } from "./work.ts"

const item = (userId: string, rowId: string): WorkItem => ({
  runId: "run-1",
  userId,
  aiColumnId: "col-1",
  rowId,
  kind: "bulk"
})

const TestConfig: Layer.Layer<QueueConfig> = Layer.succeed(QueueConfig, {
  ...defaultQueueConfig,
  bulkConcurrency: 2,
  interactiveConcurrency: 1,
  maxAttempts: 3,
  claimTimeoutMillis: 40,
  pollIntervalMillis: 20,
  activeRefreshMillis: 30,
  idlePollMillis: 10,
  backoffBaseMillis: 1,
  backoffMaxMillis: 2,
  finalizeIntervalMillis: 100,
  finalizeBatchSize: 10
})

const TestDirectory: Layer.Layer<QueueDirectory> = Layer.succeed(QueueDirectory, {
  active: Effect.succeed([queueName("a", "bulk"), queueName("b", "bulk")])
})

const StoreLayer = PersistedQueue.layer.pipe(Layer.provideMerge(PersistedQueue.layerStoreMemory))

const TestLayers = Layer.mergeAll(StoreLayer, TestConfig, TestDirectory)

const offerAll = (targets: ReadonlyArray<WorkItem>) =>
  Effect.forEach(
    targets,
    (work) =>
      PersistedQueue.make({ name: queueName(work.userId, work.kind), schema: WorkItem }).pipe(
        Effect.flatMap((queue) => queue.offer(work, { id: `${work.userId}:${work.rowId}` }))
      ),
    { discard: true }
  )

describe("scheduler", () => {
  it("serves every active user's queue without one user monopolising a pass", async () => {
    const targetItems = [
      item("a", "r1"),
      item("a", "r2"),
      item("a", "r3"),
      item("b", "s1"),
      item("b", "s2")
    ]

    const program = Effect.gen(function*() {
      const seen = yield* Ref.make<ReadonlyArray<string>>([])
      yield* offerAll(targetItems)

      const fiber = yield* runWorkerWith({
        handle: (work) => Ref.update(seen, (xs) => [...xs, `${work.userId}:${work.rowId}`])
      }).pipe(Effect.forkChild)

      yield* Effect.sleep(Duration.millis(400))
      yield* Fiber.interrupt(fiber)
      return yield* Ref.get(seen)
    })

    const seen = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))

    expect(new Set(seen)).toEqual(new Set(["a:r1", "a:r2", "a:r3", "b:s1", "b:s2"]))
    expect(seen.length).toBe(5)
  })
})

describe("queueKindOf", () => {
  it("reads the class from the queue name", () => {
    expect(queueKindOf("user:abc:bulk")).toBe("bulk")
    expect(queueKindOf("user:abc:interactive")).toBe("interactive")
    expect(queueKindOf("something-else")).toBeNull()
  })
})
