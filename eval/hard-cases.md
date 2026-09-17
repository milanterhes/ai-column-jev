# Hard cases — a fixture E4 can actually learn from

`E4-result.md` closed inconclusive because the 35-row sample was too easy: Jev answered all 24
answerable rows correctly, so there were no errors to correlate with confidence. This fixture
exists to produce those errors. It is **24 rows of the same yes/no column** — "Is this a feature
request?" — chosen so that a reasonable model (and a reasonable person) will get some wrong.

## Files

| File | Contents |
| --- | --- |
| `hard-cases.csv` | Uploadable rows: `case_id, account, plan, subject, message`. No label column. |
| `hard-cases.labels.tsv` | Ground truth: `case_id, ground_truth` (`yes`/`no`), `rationale`. |

The CSV deliberately carries **no `ground_truth` column**. The column sends the whole row as
`state`, so a label in the CSV would leak the answer to the model and invalidate the measurement.

The shapes are intentional: complaints that implicitly request a capability; requests phrased as
questions; bug reports that are really design disagreements; requests for something that exists,
but not in the way asked; "can you make X do Y" where X exists. Where a case is genuinely 50/50 the
rationale says so — the label is one defensible reading, not a certainty, and that ambiguity is the
point.

## How to use it

1. Upload `hard-cases.csv` as a dataset.
2. Create the column under test — the E4 "Feature request?" column, same instruction and labels:
   `labels[0]` = Yes, `labels[1]` = No, `needsReviewThreshold` = 0.6.
3. Run the column over all 24 rows.
4. Join the stored results back to `hard-cases.labels.tsv` on `case_id`.
5. Compare `selected_value` against `ground_truth`, then repeat E4's real question: **bucket the
   answerable rows by `confidence` and check whether agreement in the confident bucket is higher
   than in the review bucket.**

## Why this is not wired into `measure.ts`

`measure.ts` selects the dataset by `filename = 'customer-feedback.csv'` and joins rows on a
`ticket_id` field. This fixture uses `case_id` and a different dataset, so it needs its own runner
(Step 4 above). Wiring it in would mean changing the harness, which is out of scope here; the
fixture is the deliverable, the runner is a follow-up.

## What success looks like

Not a high score. The fixture has done its job if some answerable rows are answered **and wrong**,
spread across confidence values — that is the first data that can confirm or kill the thesis that
confidence separates right from wrong.
