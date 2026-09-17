import * as Schema from "effect/Schema"

/**
 * Row shapes for the spreadsheet domain.
 *
 * Repos decode raw driver rows through these, never via a cast — the driver's
 * JS shape is not our type until the schema says so. Numeric columns are
 * `double precision` in Postgres so the driver hands back real numbers rather
 * than strings.
 */

export const ColumnType = Schema.Literals(["yes_no", "category", "score"])
export type ColumnType = Schema.Schema.Type<typeof ColumnType>

export const ResultStatus = Schema.Literals([
  "high_confidence",
  "needs_review",
  "unable_to_determine",
  "failed"
])
export type ResultStatus = Schema.Schema.Type<typeof ResultStatus>

export const Label = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String)
})
export type Label = Schema.Schema.Type<typeof Label>

export const Dataset = Schema.Struct({
  id: Schema.String,
  user_id: Schema.String,
  name: Schema.String,
  filename: Schema.String,
  row_count: Schema.Number,
  column_count: Schema.Number,
  columns: Schema.Array(Schema.String),
  storage_key: Schema.NullOr(Schema.String),
  created_at: Schema.Date
})
export type Dataset = Schema.Schema.Type<typeof Dataset>

export const DatasetRow = Schema.Struct({
  id: Schema.String,
  dataset_id: Schema.String,
  row_index: Schema.Number,
  data: Schema.Record(Schema.String, Schema.Unknown)
})
export type DatasetRow = Schema.Schema.Type<typeof DatasetRow>

export const AiColumn = Schema.Struct({
  id: Schema.String,
  dataset_id: Schema.String,
  name: Schema.String,
  type: ColumnType,
  instruction: Schema.String,
  labels: Schema.Array(Label),
  criteria_version: Schema.Number,
  kind: Schema.Literals(["single", "composite"]),
  composition: Schema.NullOr(Schema.Unknown),
  ordered: Schema.Boolean,
  needs_review_threshold: Schema.Number,
  created_at: Schema.Date
})
export type AiColumn = Schema.Schema.Type<typeof AiColumn>

export const Question = Schema.Struct({
  id: Schema.String,
  ai_column_id: Schema.String,
  key: Schema.String,
  type: ColumnType,
  instruction: Schema.String,
  labels: Schema.Array(Label),
  ordinal: Schema.Number
})
export type Question = Schema.Schema.Type<typeof Question>

export const Result = Schema.Struct({
  id: Schema.String,
  ai_column_id: Schema.String,
  row_id: Schema.String,
  selected_value: Schema.NullOr(Schema.String),
  confidence: Schema.NullOr(Schema.Number),
  provider_confidence: Schema.NullOr(Schema.Number),
  sufficiency: Schema.NullOr(Schema.Number),
  status: ResultStatus,
  criteria_version: Schema.Number,
  answers: Schema.NullOr(Schema.Unknown),
  detail: Schema.NullOr(Schema.Unknown),
  provider_response: Schema.NullOr(Schema.Unknown),
  in_audit: Schema.Boolean,
  created_at: Schema.Date
})
export type Result = Schema.Schema.Type<typeof Result>

export const Correction = Schema.Struct({
  id: Schema.String,
  ai_column_id: Schema.String,
  row_id: Schema.String,
  value: Schema.String,
  corrected_by: Schema.String,
  created_at: Schema.Date
})
export type Correction = Schema.Schema.Type<typeof Correction>

export const BatchRun = Schema.Struct({
  id: Schema.String,
  ai_column_id: Schema.String,
  status: Schema.Literals(["running", "completed", "cancelled", "failed"]),
  total_rows: Schema.Number,
  cancelled: Schema.Boolean,
  input_tokens: Schema.Number,
  started_at: Schema.Date,
  completed_at: Schema.NullOr(Schema.Date)
})
export type BatchRun = Schema.Schema.Type<typeof BatchRun>
