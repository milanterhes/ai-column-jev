# Corrections layered over model output

**Type:** grilling
**Status:** resolved
**Assignee:** milanterhes
**Blocked by:** 05
**Context:** inherits from **One result shape across the three column types** — Result, Status, selected value, and the AI column's label set are settled; this ticket decides only how a human correction layers over them

## Question

Decide how a human correction relates to the model's result, given the brief's hard rule: **store human corrections separately from model output; do not overwrite the original model result.**

Settle:

- The two-layer model. Is a correction a field on the result, or its own record with an author and timestamp? What is the "effective value" that filters, summaries, and export use?
- Which value a semantic cell displays once corrected, and how the user can tell it was corrected rather than computed.
- Whether a correction can be reverted, and whether corrections survive re-running the column.
- What happens if the user corrects a row and then re-previews or re-runs with an edited rule: is the correction orphaned, preserved, or re-applied.
- Whether corrections count toward the "needs review" tally and the high-confidence count.

This is what makes the review workflow honest rather than a decorative overlay.

## Answer

**A correction is its own record, anchored to the *(AI column, row)* pair — never to a result.** It lives in its own table and holds the corrected label, the user who made it, and when. One current correction per pair; a later one supersedes the earlier. Reverting is deleting the record.

This anchoring is the whole decision. A result is rewritten by every re-run — preview recomputes by rule, and a rule edit triggers re-evaluation — so anchoring a correction to a result would make human work fragile in exactly the workflow that generates it. Anchored to the pair, a human's judgment outlives any number of model re-runs. *(Rejected: fields on the result row, which keeps model output and human judgment inside one mutable row and lets the "do not overwrite the model result" rule die quietly.)*

**One "effective value", used everywhere.** *Effective value = the correction if one exists, otherwise the model's selected value.* Filters, sorts, summaries, the review queue, and export all read it. The model's raw value stays fully intact and is read in exactly one place: the row-detail view. If two surfaces could disagree about what a cell contains, the user would have no ground truth — which a product selling reliable judgment cannot afford.

**Corrections survive every re-run, including after a rule edit.** Corrected rows keep their correction; only uncorrected rows are regenerated. The row stays **visibly marked as corrected**, which is what makes this safe — a corrected cell must never be mistaken for fresh model output. A human's judgment about a row does not expire because the model was asked a different question, and silently discarding the product's most expensive human work immediately after the user edited a prompt to improve things would make review feel worthless. *(Rejected: clearing on rule edit, which destroys work to make a point; and a warning dialog, which puts friction on the most common iteration loop.)*

**Two different numbers, both honest.**

- The **run summary** reports the **model's** counts — high confidence, needs review, unable to determine, failed — and never changes. It is a report on the run.
- The **review queue** shows **still-to-review**: rows whose status is `needs_review` **and** which have no correction. It shrinks as the user works.

"How uncertain was the model?" and "how much work is left for me?" are different questions, and one number cannot answer both. *(Rejected: letting corrections move the summary counts, which rewrites history so the report stops describing the run; and ignoring corrections entirely, which leaves a fully-reviewed dataset showing a backlog that no longer exists.)*

**A correction is constrained to the column's label set**, and rows the model could not judge **are** correctable. The label constraint is what keeps the column a column — filters, summaries, and CSV export all assume a closed set, and free text would make it ungroupable. Allowing humans to resolve rows marked `unable_to_determine` or `failed` is the highest-value thing the review workflow does: it is how a partly-unusable dataset becomes a finished one. Rows the model answered confidently may be corrected too; nothing is off limits.

### Handed to other tickets

- **Export shape for the slice** inherits: export reads the **effective value**; whether the model's own value is emitted alongside it is decided there.
- **Table behaviour in the slice** inherits: a corrected cell must be visually distinct from a computed one.
- **Dataset privacy and lifecycle** inherits: corrections cascade with the dataset like every other derived row.
