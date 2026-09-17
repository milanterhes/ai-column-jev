# E4 — does confidence separate right from wrong?

**Run:** `npx tsx eval/measure.ts "Feature request?"` against the 35-row sample, before T01/T02.
**Ground truth:** `eval/customer-feedback.labels.tsv`, authored alongside the sample so each row's
intent is known rather than inferred.

## Result

| Metric | Value |
| --- | --- |
| Answerable rows answered | 24/28 (86%) |
| Answerable rows wrongly discarded | **4** — T-1005, T-1010, T-1015, T-1029 |
| Genuinely unusable rows caught | **7/7 (100%)** |
| Overall agreement | 24/24 (100%) |
| Minority class ("yes") | **4/4 (100%)** |
| Base rate | **83% single class** |

Confidence buckets, all 100% correct:

```
0.00–0.79  ██████████████████  100%  (1/1)
0.80–0.94  ██████████████████  100%  (1/1)
0.95–1.00  ██████████████████  100%  (22/22)
```

## Verdict: **inconclusive, not failed**

The kill criterion was "if agreement on confident rows does not separate from agreement on
reviewed rows, confidence carries no information". There is no separation — **because there are
no errors to separate.** The model got all 24 answerable rows right, including the minority
class. You cannot correlate confidence with correctness when correctness is constant.

**The sample is too easy to answer E4.** It was authored with clear intent, and on simple,
well-specified criteria Jev is near-perfect.

### What that implies — and it is not comfortable

1. **A high base rate makes accuracy a vanity metric.** 83% of rows are one class, so "83%
   accurate" describes a model that answers "no" every time. **The report must be per class, and
   must state the base rate.** Otherwise our headline number is exactly the kind of thing a
   careful buyer dismantles.
2. **"Proof of accuracy" is weakest exactly where criteria are easy** — because accuracy is high
   and boring. The measurement story earns its keep on *subjective* columns: churn risk, ICP fit,
   frustration. Those are the columns where humans disagree with each other, never mind with the
   model.
3. **So a proper E4 needs hard cases, not more rows.** Arguable rows where two reasonable people
   would disagree. The sample has a few (T-1021, T-1026) and the model got them right too.

## The finding that survives

**The review queue's real job is insufficiency, not disagreement.** Every genuinely unusable row
was caught, and no answerable row was misjudged — but 4 substantive rows were wrongly discarded
as unusable. The queue exists to catch thin data and edge cases, not model error.

**So T01 is the right next move, and it is measurable:** those 4 false unusables are the target.
Re-run this harness after T01 and the number should fall while the 7/7 catch rate holds.

## Consequence for the plan

E4 cannot be closed on this fixture. Either:

- **(a)** author a harder evaluation set — rows with genuinely arguable answers, ideally drawn
  from real disagreements rather than invented; or
- **(b)** accept that for simple criteria the queue is an insufficiency mechanism, and position
  the accuracy report on subjective columns where it has something to say.

I would do both, and (a) is a few hours of writing. Do not let E4 sit "passed" on this evidence.
