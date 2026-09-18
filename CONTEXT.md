# AI Column

A self-serve web app where a user uploads a CSV, adds **AI columns** that require
human-like judgment, reviews the rows the model is unsure about, and exports the
enriched CSV.

This file is the canonical vocabulary. Per-row judgment is done by **Jev**
(TypeSafe AI's System One model); a general-purpose LLM is used only to help
phrase a rule and never evaluates a row.

## Language

**Dataset**:
An uploaded CSV owned by exactly one user, with its original `filename`, its
`columns` (the original headers, in order), and its parsed rows. The grid is a
rendering of this.
_Avoid_: sheet, table, file

**Dataset row**:
One CSV record, stored as `dataset_row.data` (a JSON object keyed by the original
header) with a stable `row_index`. Rows are never mutated by evaluation.
_Avoid_: record, entry

**AI column**:
A column the user defines whose values are judgments rather than data. Has a
`name`, a `type` (`yes_no` | `category` | `score`), the `instruction`, and the
`labels` being chosen between. Its `kind` is `single` today; `composite` is
reserved for columns that compose a value from several answers.
_Avoid_: semantic column, formula, derived column

**Question**:
An extra judgment a column carries alongside its own, stored in the `question`
table keyed by `ai_column_id` + `key`. Questions exist because a request has a
token floor — a question costs ~30 tokens against a ~390-token floor, so six cost
1.36×, not 6×. The column's own headline question is *not* a `Question` row; it
lives on `ai_column` and is keyed `judgment` in a request.
_Avoid_: sub-question, follow-up, field

**Evaluation**:
One row judged against one question. **A unit of account, not an entity** — there
is no `evaluation` table. `usage_counter.evaluations` counts them.
_Avoid_: scoring run, inspection

**Result**:
The stored outcome of evaluating one row against one AI column: the
`selected_value`, the `confidence`, the `status`, every question's answer in
`answers`, and the raw `provider_response`. Unique per `(ai_column_id, row_id)`.
_Avoid_: answer, prediction, judgment

**Correction**:
A human's override of a Result, recorded with `corrected_by`. Corrections are the
signal accuracy is measured from.
_Avoid_: edit, fix, feedback

**Effective value**:
The correction if one exists, otherwise the model's selected value. Every surface
— grid, review, report, export — shows the effective value, so a correction is
never a side note.
_Avoid_: final value, resolved value

**Status**:
One of `high_confidence`, `needs_review`, `unable_to_determine`, `failed`.
`needs_review` means confidence fell below the column's threshold;
`unable_to_determine` means the provider's sufficiency check failed — the row did
not contain what the question needed.
_Avoid_: state, verdict

**Needs-review threshold**:
A per-column confidence floor (`needs_review_threshold`), not a global constant.
Defaults are per output type — `0.6` for `yes_no`, `0.8` otherwise — because
Jev's confidence means a different thing in each mode. See `defaultThresholdFor`.
_Avoid_: cutoff, sensitivity

**Criteria version**:
An integer on the column and on every Result. Refining criteria is how the
product improves, and results produced under different criteria are not
comparable, so each result records the version that produced it.
_Avoid_: revision, schema version

**Batch run**:
One asynchronous execution of an AI column over its rows: `status`, `total_rows`,
`cancelled`, `input_tokens`. Created on request; drained by `apps/worker`.
_Avoid_: job, task, batch

**Audit**:
A random sample of rows the user never reviewed (`result.in_audit`), re-checked to
measure the column's accuracy. The **only unbiased** agreement figure, because
review is requested for uncertain rows — so agreement measured on reviewed rows
is biased downward. The report says so in the UI.
_Avoid_: spot check, validation

**Report**:
A computed summary of a column's quality — agreement from corrections, the
confidence distribution, and the audit. Derived on request, never stored.
_Avoid_: dashboard, analytics

**Usage counter**:
`usage_counter`, one row per user. Survives dataset deletion and holds no row
content; it exists to meter evaluation.
_Avoid_: quota, billing, credits

**Jev**:
TypeSafe AI's System One — the per-row evaluator. Its request contract is
irregular: `choice` takes `criteria` as a label→description **map**, `score` as an
**ordered array**. Sending the wrong shape is a 422.
_Avoid_: the model, the AI, the LLM

**Noul**:
Jev's binary mode, used for `yes_no` columns. Its confidence is the **probability
of the answer it selected**, not a margin — so the threshold is 0.6, not 0.8.
_Avoid_: binary mode

## Relationships

- `Dataset` 1—N `DatasetRow`
- `Dataset` 1—N `AiColumn`
- `AiColumn` 1—N `Question`
- `AiColumn` 1—N `Result`, and 1—N `BatchRun`
- `DatasetRow` 1—N `Result` (one per column)
- `Result` 1—0..1 `Correction`
- `User` 1—N `Dataset`, and 1—1 `UsageCounter`. `User` is better-auth's `user`
  table; **there is no foreign key from `dataset` to it** — ownership is enforced
  in every query instead.

## Patterns

- **Models are plain `Schema.Struct`** in `packages/spreadsheet/src/db/models.ts`,
  not `Model.Class` and with no `select` variant. Postgres returns real `number`s
  for `double precision` and real `Date`s for `timestamptz`; the schemas say so.
- **Repos decode every driver row** through its schema
  (`Schema.decodeUnknownSync(Dataset)`) — never a cast. See ADR-0001.
- **The `Label` schema under-declares what the provider uses.** It persists
  `{ name, description }`, but labels written through the API keep `what`,
  `notFor`, `examples` and `signals` as extra JSON keys, and
  `packages/evaluate` builds Jev's criteria from them. The columns are real (they
  are what cut unusable rows from 4 to 1); the schema is the loose end.
- **The API is a hand-rolled router**, not Effect `HttpApi`: `apps/web/src/api/`
  holds the composition root (`mount.ts`), the router (`routes.ts`), and a typed
  fetch client (`client.ts`). Auth is better-auth and owns `/api/auth/*`.
- **The numbers in `packages/evaluate/src/core.ts` were measured**, not guessed.
  Read the comment before changing one.
