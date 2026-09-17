import { Context, Layer } from "effect"

/**
 * Tunables for the consumer. Slot counts are the builder's call per the
 * decision record; interactive slots exist so preview latency is guaranteed
 * even when a bulk run saturates the rest, which is why they are a separate
 * pool rather than a priority inside one pool.
 */
export interface QueueConfigShape {
  readonly bulkConcurrency: number
  readonly interactiveConcurrency: number
  readonly maxAttempts: number
  readonly claimTimeoutMillis: number
  readonly pollIntervalMillis: number
  readonly activeRefreshMillis: number
  readonly idlePollMillis: number
  readonly backoffBaseMillis: number
  readonly backoffMaxMillis: number
  readonly finalizeIntervalMillis: number
  readonly finalizeGraceMillis: number
  readonly finalizeBatchSize: number
  readonly tableName: string
}

export const defaultQueueConfig: QueueConfigShape = {
  bulkConcurrency: 4,
  interactiveConcurrency: 2,
  maxAttempts: 4,
  claimTimeoutMillis: 750,
  pollIntervalMillis: 500,
  activeRefreshMillis: 1000,
  idlePollMillis: 250,
  backoffBaseMillis: 1000,
  backoffMaxMillis: 30_000,
  finalizeIntervalMillis: 2000,
  finalizeGraceMillis: 5000,
  finalizeBatchSize: 100,
  tableName: "effect_queue"
}

export class QueueConfig extends Context.Service<QueueConfig, QueueConfigShape>()(
  "@app/queue/QueueConfig"
) {}

export const QueueConfigLive: Layer.Layer<QueueConfig> = Layer.succeed(QueueConfig, defaultQueueConfig)
