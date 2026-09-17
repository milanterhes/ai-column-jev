import { NodeChildProcessSpawner, NodeFileSystem, NodePath, NodeRuntime } from "@effect/platform-node"
import { PgLive } from "@app/core"
import { Effect } from "effect"
import { loadEnv } from "./env.ts"

loadEnv()

/**
 * The worker process. It owns the `PersistedQueue` consumers — the only place
 * that calls the evaluation provider, so that rate-limit learning is shared
 * rather than split between this process and the web app.
 *
 * See `.scratch/semantic-spreadsheet/spec.md` §7 and the decision
 * "Batch-run semantics". Empty while the base is stood up: the per-user queues,
 * the round-robin claim loop and the evaluation handler land here.
 */
const program = Effect.gen(function*() {
  yield* Effect.log("worker starting")
  yield* Effect.never
})

NodeRuntime.runMain(
  program.pipe(
    Effect.provide(PgLive),
    Effect.provide(NodeChildProcessSpawner.layer),
    Effect.provide(NodeFileSystem.layer),
    Effect.provide(NodePath.layer)
  )
)
