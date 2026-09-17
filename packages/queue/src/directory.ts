import { Context, Effect, Layer } from "effect"
import { SqlClient, SqlError } from "effect/unstable/sql"
import { QueueConfig } from "./config.ts"

/**
 * Which user queues currently hold work.
 *
 * The queue store exposes no way to list non-empty queues, so the scheduler
 * needs a directory. Reading the store's own table is deliberate and limited to
 * *reading*: cancellation and retry never mutate it, because coupling to a
 * library's schema for writes breaks on upgrade. The table name is ours to
 * configure, so the read tracks the same name the store was built with.
 */
export interface QueueDirectoryShape {
  readonly active: Effect.Effect<ReadonlyArray<string>, SqlError.SqlError>
}

export class QueueDirectory extends Context.Service<QueueDirectory, QueueDirectoryShape>()(
  "@app/queue/QueueDirectory"
) {}

export const SqlQueueDirectory: Layer.Layer<QueueDirectory, never, SqlClient.SqlClient | QueueConfig> =
  Layer.effect(
    QueueDirectory,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const config = yield* QueueConfig
      const table = sql(config.tableName)

      const active: QueueDirectoryShape["active"] = Effect.gen(function*() {
        const rows = yield* sql`
          SELECT DISTINCT queue_name FROM ${table}
          WHERE completed = FALSE AND attempts < ${config.maxAttempts}
        `
        return rows.map((row) => String(row["queue_name"]))
      })

      return QueueDirectory.of({ active })
    })
  )
