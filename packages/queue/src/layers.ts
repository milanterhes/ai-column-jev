import { Duration } from "effect"
import * as PersistedQueue from "effect/unstable/persistence/PersistedQueue"
import { defaultQueueConfig } from "./config.ts"

/**
 * The SQL store auto-migrates its own table and claims with
 * `FOR UPDATE SKIP LOCKED`. Both the table name and the poll interval come from
 * the same config the consumer reads, so the directory and the store cannot
 * disagree about which table is in play.
 */
export const PersistedQueueStoreLive = PersistedQueue.layerStoreSql({
  tableName: defaultQueueConfig.tableName,
  pollInterval: Duration.millis(defaultQueueConfig.pollIntervalMillis)
})

export const PersistedQueueFactoryLive = PersistedQueue.layer
