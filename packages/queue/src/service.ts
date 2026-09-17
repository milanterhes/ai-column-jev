import { createHash } from "node:crypto"
import { Effect } from "effect"
import { EvaluationError, EvaluationService } from "@app/evaluate"
import { countResultsByStatus } from "@app/spreadsheet/repo"
import { SqlClient, SqlError } from "effect/unstable/sql"
import * as PersistedQueue from "effect/unstable/persistence/PersistedQueue"
import { QueueConfig } from "./config.ts"
import { QueueDirectory } from "./directory.ts"
import { handleRow, type RowHandler } from "./handler.ts"
import { runWorkerWith } from "./scheduler.ts"
import { BATCH_CHUNK_SIZE } from "@app/evaluate"
import { WorkItem, queueName, type WorkKind } from "./work.ts"

/**
 * Enqueue one item per row. `scope` namespaces the queue id: pass the run id
 * for a full run so a replay of the same run dedupes, and a fresh token for a
 * preview, whose rows are recomputed on every run ("Re-previewing recomputes
 * every previewed row"). Retrying failed rows is a new scope, which re-offers
 * fresh ids, as "Batch-run semantics" requires.
 */
/**
 * The queue's `id` column is `varchar(36)` — sized for a UUID, not for a
 * composite key. `scope:column:row` is 110 characters and the insert fails.
 * Hash it deterministically: same inputs give the same id, so the dedupe on
 * replay still works, and 36 hex characters is 144 bits of collision space.
 */
const MAX_QUEUE_ID = 36

export const workItemId = (scope: string, aiColumnId: string, rowId: string): string =>
  createHash("sha256")
    .update(`${scope}\u0000${aiColumnId}\u0000${rowId}`)
    .digest("hex")
    .slice(0, MAX_QUEUE_ID)

export interface EnqueueTarget {
  readonly runId: string | null
  readonly userId: string
  readonly aiColumnId: string
  readonly kind: WorkKind
  readonly scope: string
}

export const enqueueRows = (target: EnqueueTarget, rowIds: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const queue = yield* PersistedQueue.make({
      name: queueName(target.userId, target.kind),
      schema: WorkItem
    })

    // Bulk work is chunked: measured at 1.8x cheaper and ~40x faster than one
    // request per row. Interactive work stays one row per item so a preview is
    // never stuck behind a chunk.
    const items: ReadonlyArray<{ readonly rowIds: ReadonlyArray<string>; readonly key: string }> =
      target.kind === "bulk"
        ? Array.from({ length: Math.ceil(rowIds.length / BATCH_CHUNK_SIZE) }, (_, index) => ({
            rowIds: rowIds.slice(index * BATCH_CHUNK_SIZE, (index + 1) * BATCH_CHUNK_SIZE),
            key: `chunk-${index}`
          }))
        : rowIds.map((rowId) => ({ rowIds: [rowId], key: rowId }))

    yield* Effect.forEach(
      items,
      (item) =>
        queue.offer(
          {
            runId: target.runId,
            userId: target.userId,
            aiColumnId: target.aiColumnId,
            rowId: item.rowIds[0] ?? "",
            rowIds: [...item.rowIds],
            kind: target.kind
          },
          { id: workItemId(target.scope, target.aiColumnId, item.key) }
        ),
      { discard: true }
    )
  })

/** Progress is derived from the results table, never tracked in a counter. */
export const columnProgress = (aiColumnId: string) => countResultsByStatus(aiColumnId)

export const runQueueWorker: Effect.Effect<
  void,
  never,
  | PersistedQueue.PersistedQueueStore
  | QueueConfig
  | QueueDirectory
  | EvaluationService
  | SqlClient.SqlClient
> = Effect.gen(function*() {
  const config = yield* QueueConfig
  const handler: RowHandler<EvaluationError | SqlError.SqlError, EvaluationService | SqlClient.SqlClient> = {
    handle: (work, attempt) => handleRow(config, work, attempt)
  }
  yield* runWorkerWith(handler)
})
