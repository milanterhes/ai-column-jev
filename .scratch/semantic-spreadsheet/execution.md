# Execution — how to actually get there

`direction.md` says where to go. `plan.md` says what to build. This says **how to sequence it so
the riskiest beliefs die first and cheapest.**

---

## The reordering I would make

`plan.md` put Milestone 1 (fan-out) before Milestone 2 (measurement). **Swap them.**

The strategy says accuracy is the differentiator. The accuracy loop needs **no schema change** —
agreement and the column report work on what we already store. Fan-out is a large investment in
the core noun of the product, and it should be justified by a differentiator we have already
proven, not the other way round.

So: **correctness → measurement → fan-out → retention.**

---

## Stage 0 — Kill the four beliefs that could sink this (one week, no schema change)

Each of these is cheap, runnable against the live API today, and has an explicit **kill
criterion**. If one dies, we find out before spending weeks.

### E1 — Does fan-out actually flatten cost? ✅ **already run**

Measured on a real support ticket with our own state shape:

| | input tokens |
| --- | --- |
| 1 question | 419 |
| 6 questions | 569 |

**Six columns cost 1.36x one column, not 6x.** Marginal question cost is ~30 tokens.

**But read the fine print, because it changes the plan.** The win comes from the *state* being
shared, and our state is ~390 tokens of the 419. A row's text cannot be amortised across
columns — only the request overhead and the questions can. The vendor's headline 12.2x comes
from 13 questions over one shared document; ours is 4–7x and shrinks as rows get richer.

**Consequence:** for our shape the *second* lever is bigger than the first — **batching many rows
into one state**, so the per-request overhead amortises across rows too. That was T12, ranked as a
spike. It should be reranked higher, and measured next:

```
20 rows, one call:   base(390) + 20 rows + 20×M×30
20 rows, 20 calls:   20×(390 + row + M×30)
```

**Kill criterion:** if batching rows cannot be made to work (answers stop being attributable to
rows, or the ~32k token budget caps the batch at a handful), then the volume story weakens and
the beachhead must be small-batch workflows.

### E2 — Does structured criteria + decomposition fix the unusable rows?

Run the sample CSV with T01 applied: structured `true`/`false` criteria with `what`, `not_for`
and `examples`, and a decomposed `state` with questions naming their fields by path.

**Kill criterion:** if `unable_to_determine` on rows with *substantive content* stays above ~15%
for a Yes/No column, the four-state model is not trustworthy and "unable to determine" should be
cut from the product rather than shipped.

### E3 — Does Noul give graded confidence for binary questions?

Current state: a two-option Choice returns 1.00 on every judged row. Re-run the same rows with
Noul and plot the histogram.

**Kill criterion:** if Noul's probability is also saturated (everything >0.95 or <0.05), then
confidence is simply not a useful triage signal for binary columns, and the honest product is
"binary columns have no review queue".

### E4 — Does review-derived accuracy hold? **The one that matters most.**

Hand-label 40 rows of the sample against one column. Then compare:

- agreement on the rows the model flagged for review, versus
- agreement on the rows it called confident.

**Kill criterion:** if there is no separation — if the model is as wrong on its confident rows as
its uncertain ones — then confidence carries no information and the entire "proof of accuracy"
position collapses. This is the cheapest possible test of the whole thesis and it should be run
first.

---

## The trap that E4 is designed to catch

**Corrections are not a random sample.** People review uncertain rows first. So agreement measured
on reviewed rows is **biased downward** — it tells you how the model does where you were already
suspicious, not how it does overall.

Publishing that number as "accuracy" would be misleading in the flattering-looking direction being
*wrong*, and it is exactly the kind of thing that gets a product's credibility destroyed in a
procurement call.

**The honest design:** offer a **random audit**. Sample N rows the user never reviewed, ask them
to confirm or correct, and report that as the accuracy estimate. Then report both, clearly
labelled:

> Agreement on rows you reviewed: **78%** → Estimated accuracy across all rows: **94%** (from a
> random audit of 100)

The first is a fact about the review queue. The second is a fact about the model. Confusing them
is the failure mode.

---

## Stage 1 — Correctness (≈1 week)

T01, T02, T03. Small, and it produces the before/after numbers that become the first honest
marketing asset: *"on 35 real support tickets, unusable rows fell from 11 to 3, and the review
queue became reachable."*

**Gate to Stage 2:** E2 and E3 both pass.

---

## Stage 2 — The accuracy loop (≈2 weeks)

T09 (agreement from corrections) and T10 (the column report), plus the **random audit** from
above, which is not yet a ticket. Add it as **T21**.

This is the differentiator and it ships on today's schema.

**Gate to Stage 3:** at least three real users have run it on their own data and can state their
column's accuracy number without our help.

---

## Stage 3 — Fan-out (≈3–4 weeks)

T04–T08, now justified by the accuracy story rather than hoped for. Include the row-batching work
reranked up from T12.

**Gate to Stage 4:** six columns on one sheet cost under 1.5x the tokens of one column, measured
in production.

---

## Stage 4 — Retention (≈2 weeks)

T11 (saved rules) plus watch mode. Now the product has a reason to be opened next month.

---

## In parallel from week 2 — the thing no agent can do

**Get five teams running their real monthly export through it.** Not a demo, not a trial — their
actual feedback, their actual criteria, their actual month-end deadline.

The beachhead thesis is the only assumption no experiment can settle, and it is settled by five
conversations. What to ask:

1. How many rows, and how often? *(Is it recurring?)*
2. Who reads them today, and how long does it take? *(Is the pain real and quantified?)*
3. What are the criteria, and are they written down? *(Can a question hold them?)*
4. Where does the output go, and who sees it? *(Is there a defensible artefact?)*
5. What would make you not trust it? *(This is the accuracy question.)*

If three of five say "yes, monthly, and it takes someone two days", the beachhead holds. If none
do, the direction is wrong and Stage 3 should not be built.

---

## Weekly scoreboard

Four numbers, no vanity metrics:

1. **Unusable rows** on a fixed sample — should fall, and stay low.
2. **Review-queue hit rate** — of rows flagged, what share did the human actually change? If
   people accept everything, the queue is noise.
3. **Tokens per row per column** — the economics, watched continuously.
4. **Teams running it monthly** — the only one that is not a proxy.

---

## What would make me stop

- **E4 fails** — confidence carries no information. The accuracy position is dead, and this
  becomes a thin wrapper over an API.
- **Five conversations, no recurring pain** — the beachhead is wrong and the product is a toy.
- **Row-batching is impossible and sheets are large** — the volume claim fails and the product is
  only for small sheets, which is not a business.
- **TypeSafe raises prices by an order of magnitude** — the economics inverts. Keep the provider
  seam clean, and keep a second provider's adapter in mind from the start.

---

## The critical path, in one line

**E4 → T01/T02 → T09/T10/T21 → T04–T08 → T11.** Everything else is parallel or optional.
