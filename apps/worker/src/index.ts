import { NodeChildProcessSpawner, NodeFileSystem, NodeHttpClient, NodePath, NodeRuntime } from "@effect/platform-node"
import { PgLive } from "@app/core"
import { EvaluationServiceLive, JevConfig } from "@app/evaluate"
import {
  PersistedQueueStoreLive,
  QueueConfig,
  QueueConfigLive,
  SqlQueueDirectory,
  finalizeRuns,
  runQueueWorker
} from "@app/queue"
import { Duration, Effect, Layer, Schedule } from "effect"
import { loadEnv } from "./env.ts"

loadEnv()

const JevConfigLive = Layer.succeed(JevConfig, {
  apiKey: process.env["JEV_KEY"] ?? "",
  baseUrl: process.env["JEV_BASE_URL"] ?? "https://api.typesafe.ai",
  model: process.env["JEV_MODEL"] ?? "jev-latest"
})

const EvalLive = EvaluationServiceLive.pipe(
  Layer.provide(Layer.mergeAll(JevConfigLive, NodeHttpClient.layerUndici))
)

/**
 * The worker owns the `PersistedQueue` consumers — the only place that calls the
 * evaluation provider, so that adaptive rate-limit learning is shared rather
 * than split between this process and the web app.
 *
 * The consumer runs the per-user queues with a round-robin claim loop and
 * reserved interactive capacity. A separate sweep derives run completion from
 * the results table. See `.scratch/semantic-spreadsheet/spec.md` §7 and the
 * decision "Batch-run semantics".
 */
const completionSweep = Effect.gen(function*() {
  const config = yield* QueueConfig
  yield* finalizeRuns(config).pipe(
    Effect.repeat(Schedule.spaced(Duration.millis(config.finalizeIntervalMillis)))
  )
}).pipe(Effect.forkChild)

const program = Effect.gen(function*() {
  yield* Effect.log("worker starting")
  yield* completionSweep
  yield* runQueueWorker
})

const AppLive = Layer.mergeAll(EvalLive, PersistedQueueStoreLive, SqlQueueDirectory).pipe(
  Layer.provideMerge(Layer.mergeAll(PgLive, QueueConfigLive))
)

NodeRuntime.runMain(
  program.pipe(
    Effect.provide(AppLive),
    Effect.provide(NodeChildProcessSpawner.layer),
    Effect.provide(NodeFileSystem.layer),
    Effect.provide(NodePath.layer)
  )
)
