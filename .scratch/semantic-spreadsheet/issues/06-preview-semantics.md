# Preview semantics

**Type:** grilling
**Status:** resolved
**Assignee:** milanterhes
**Blocked by:** —

## Question

Decide exactly what "Preview on 10 rows" does, since the brief forbids ever running the full dataset before the user confirms.

Settle:

- **Which rows.** First N, a deterministic sample, a spread across the sheet, or rows the system judges representative. Whatever it is must be explainable to the user in one sentence.
- **How many.** The brief says both 10 and "10–20 rows". Pick the default and say whether it is adjustable.
- **What the user sees.** Results inline in the spreadsheet with confidence, plus which rows are marked low-confidence.
- **Iteration.** When the user edits the rule and previews again, what happens to the rows already evaluated: recomputed, kept, or marked stale. What happens to a preview when the user closes the drawer without confirming.
- **Promotion.** What exactly happens on "run on all rows" with respect to rows already evaluated during preview — re-evaluated or reused.
- **Failure.** What a row that errors during preview shows, and whether preview is blocked by one bad row.

## Answer

**Which rows: a spread evenly through the sheet.** The user-facing sentence is *"ten rows spread evenly through your sheet."* First-N was rejected because sheets are usually sorted by date or company, so it would systematically show the user a preview that doesn't represent their data. Random sampling was rejected as unexplainable — the same rows changing on every preview reads as a bug — and a fixed seed fixes reproducibility but not explainability.

**How many: default 10, adjustable from 5 to 50.** The brief itself wavers between 10 and "10–20", so the count is a control rather than a constant. The upper bound exists so a preview can never quietly become an expensive full run.

**Preview results are real results.** They are written to the same table, in the same shape, as ordinary Results — created together with the AI column the first time the user previews. There is no second, pretend result shape for preview: if preview and the full run could disagree, the product's core promise would be broken. Consequences:

- **Closing the drawer without running deletes the column and its preview results.** The column never existed. A column exists because the user committed to it — no half-evaluated columns left behind for the user to wonder about.
- **Promotion reuses the previewed rows.** "Run on all rows" keeps the ten results the user looked at and approved, and evaluates only the rest. Re-evaluating them would spend money to possibly show the user something different from what they signed off on. It also means the run costs exactly what the preview implied it would.

**Re-previewing recomputes every previewed row**, replacing the previous results for that column. **No caching.** A cached result is correct but indistinguishable from a stale one, and after an edit the user needs to know every number on screen reflects the rule they just wrote. At ten rows the saving is negligible and the confusion is not. The rule is: *a preview always recomputes its rows.*

**Preview is the same code path as the full run**, bounded to N rows — the same evaluation service, the same result writer, the same status logic. This is what guarantees that what the user sees in preview is what they get on the run, and it means one set of bugs rather than two.

**A failing row never blocks promotion.** It renders as failed, visibly distinct from both "needs review" and "unable to determine", and the user can proceed. Failures are retried during the full run like any other row. Blocking would let one flaky network call lock a user out of their own product, and would contradict the brief's rule that a failed subset must never destroy the whole run.

### Handed to other tickets

- **Batch-run semantics** inherits: promotion reuses preview results; the remaining-row evaluation is the batch; failed rows are retried there.
- **The evaluation-service boundary** inherits: one entry point serves both preview and full run, differing only in row count.
- **Table behaviour in the slice** inherits: preview results are indistinguishable in shape from run results.
