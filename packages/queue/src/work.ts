import * as Schema from "effect/Schema"

/**
 * The unit of background work is one *(row, AI column)* pair. A chunked or
 * per-run item was rejected in "Batch-run semantics": per-row items give exact
 * progress and minimal retry, and a replay costs a fraction of a cent.
 *
 * `kind` is the work class, not a priority: interactive work (previews) is
 * enqueued under its own queue name so reserved slots can serve it without
 * waiting behind a bulk run. Fairness is between users, so the queue name is
 * `user:<id>:<kind>` — one queue per user per class.
 */
export const WorkKind = Schema.Literals(["bulk", "interactive"])
export type WorkKind = Schema.Schema.Type<typeof WorkKind>

export const WorkItem = Schema.Struct({
  runId: Schema.NullOr(Schema.String),
  userId: Schema.String,
  aiColumnId: Schema.String,
  rowId: Schema.String,
  kind: WorkKind
})
export type WorkItem = Schema.Schema.Type<typeof WorkItem>

export const queueName = (userId: string, kind: WorkKind): string => `user:${userId}:${kind}`

export const queueKindOf = (name: string): WorkKind | null => {
  if (name.endsWith(":interactive")) return "interactive"
  if (name.endsWith(":bulk")) return "bulk"
  return null
}
