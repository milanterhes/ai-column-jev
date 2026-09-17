import { Effect } from "effect"
import { countResultsByStatus, finishBatchRun } from "@app/spreadsheet/repo"
import { SqlClient } from "effect/unstable/sql"
import type { QueueConfigShape } from "./config.ts"
import * as repo from "./repo.ts"

/**
 * `completed` means every row reached a terminal state, including failed ones;
 * a run with 8,241 good rows and one timeout is completed, not failed.
 *
 * The result count alone cannot decide this: a re-run starts with the previous
 * run's results still present, so the count already equals `total_rows` before a
 * single new item is claimed. Completion therefore also requires the run's own
 * queue items to have drained. The grace window covers the moment between the
 * run row being inserted and its items being offered.
 */
const sweep = (config: QueueConfigShape) =>
  Effect.gen(function*() {
    const startedBefore = new Date(Date.now() - config.finalizeGraceMillis)
    const runs = yield* repo.listRunningRuns(config.finalizeBatchSize, startedBefore)
    for (const run of runs) {
      if (run.cancelled) {
        yield* finishBatchRun(run.id, "cancelled")
        continue
      }
      const counts = yield* countResultsByStatus(run.ai_column_id)
      const settled = Object.values(counts).reduce((total, count) => total + count, 0)
      if (settled < run.total_rows) continue
      const pending = yield* repo.countPendingItemsForRun(
        config.tableName,
        config.maxAttempts,
        run.id
      )
      if (pending === 0) yield* finishBatchRun(run.id, "completed")
    }
  })

export const finalizeRuns = (
  config: QueueConfigShape
): Effect.Effect<void, never, SqlClient.SqlClient> =>
  sweep(config).pipe(Effect.catchCause(() => Effect.logWarning("run finalization sweep failed")))
