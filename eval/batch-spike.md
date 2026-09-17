# Row-batching spike (T12)

**Question:** can many rows be folded into one `state` so per-request overhead amortises
across rows, while each answer stays attributable to its row — and where does the request
budget actually cap the batch?

**Method:** `eval/batch-spike.ts` against the live API (`POST /v1/systemone`, `jev-latest`),
using the 35-row sample at `apps/web/public/customer-feedback.csv` for row text. N rows are
drawn cyclically from the sample with unique ids, so N can exceed 35. One judgment question per
row — *"Does this customer want a new feature to be built?"* — with the same
`Yes`/`No` criteria in every shape. Run with `npx tsx eval/batch-spike.ts`
(and `… agreement`, `… ceiling` for the focused modes).

Three shapes:

1. **per-row** — N sequential calls, one row each, one question each.
2. **batch** — one call, N rows in one `state`, N questions naming the row by path
   (`rows[i]`), one per row.
3. **single-question** — one call, N rows in one `state`, one `choice` over all row ids.

---

## Results

### N = 5

| shape | calls | input tokens | output | latency | answers | attributable | agreement vs per-row |
| --- | --: | --: | --: | --: | --: | --: | --: |
| per-row | 5 | 2,471 | 165 | 2,302 ms | 5/5 | 5/5 | — |
| batch | 1 | 1,615 | 153 | 297 ms | 5/5 | 5/5 | 100% |
| single-question | 1 | 1,138 | 65 | 338 ms | 1/5 | 1/5 | 100% |

### N = 20

| shape | calls | input tokens | output | latency | answers | attributable | agreement vs per-row |
| --- | --: | --: | --: | --: | --: | --: | --: |
| per-row | 20 | 9,648 | 660 | 5,645 ms | 20/20 | 20/20 | — |
| batch | 1 | 5,482 | 613 | 281 ms | 20/20 | 20/20 | 100% |
| single-question | 1 | 3,317 | 210 | 273 ms | 1/20 | 1/20 | 100% |

### N = 50

| shape | calls | input tokens | output | latency | answers | attributable | agreement vs per-row |
| --- | --: | --: | --: | --: | --: | --: | --: |
| per-row | 50 | 24,165 | 1,650 | 14,245 ms | 50/50 | 50/50 | — |
| batch | 1 | 13,429 | 1,543 | 355 ms | 50/50 | 50/50 | 100% |
| single-question | 1 | 7,880 | 510 | 389 ms | 1/50 | 1/50 | 100% |

### At scale (agreement check)

| N | per-row input | batch input | batch share | batch answers | agreement |
| --: | --: | --: | --: | --: | --: |
| 100 | 48,489 | 26,803 | 55% | 100/100 | 100% |
| 200 | 96,981 | 53,895 | 56% | 200/200 | 100% |

### Ceiling (one call, N questions)

| N | HTTP | request bytes | input tokens | answers |
| --: | --: | --: | --: | --: |
| 100 | 200 | 71,939 | 26,803 | 100/100 |
| 200 | 200 | 144,484 | 53,895 | 200/200 |
| 220 | 200 | 159,444 | 59,412 | 220/220 |
| 240 | 200 | 173,639 | 64,759 | 240/240 |
| 250 | **400** | 181,211 | 0 | 0/250 |

Marginal costs, from the N=20→50 and N=50→200 slopes:

- per-row: **~485 input tokens per row** (`96981 − 24165) / 150 = 485`)
- batch: **~270 input tokens per row** (`53895 − 13429) / 150 = 270`)
- batch is **~56% of per-row tokens — 1.8× cheaper**, flat in N.
- batch latency at N=200 is **~1.3 s**, against ~57 s for 200 sequential calls at the measured
  ~285 ms/call — **~40× lower wall clock** (sequential baseline; the real queue is concurrent).

Cost, at the vendor's $0.042 / M input tokens: per-row ≈ **$2.04 / 100k rows**, batch ≈
**$1.13 / 100k rows**. The saving is ~$0.91 / 100k rows — real but small in absolute terms. The
lever batching pulls is **throughput**, not price.

---

## Verdict

**Batching is worth doing, in the shape-2 form: many rows in one `state`, many path-addressed
questions.** It cut input tokens to ~56% and wall-clock by ~40× while, at every size tested up
to N=200, returning exactly one answer per row that agreed 100% with the same row judged alone.
Attribution does not degrade with batch size in this range — the row ids key the answers, and
the model followed `rows[i]` path references.

**The practical ceiling is request *size*, not the documented token budget.** N=240 succeeded at
64,759 input tokens and 173,639 bytes; N=250 (181,211 bytes) failed with HTTP 400 and returned
nothing. Two things follow:

- The ~32,000-token request budget in the spec is **not** the binding limit as observed — a
  200-row batch consumed 53,895 tokens (1.7× the documented budget) and succeeded. If we honour
  32k conservatively, the ceiling is ~**117 rows** (≈ `(32000 − 1400) / 270`); the observed
  wall is ~**240 rows** for this row text. The 400 at ~180 KB looks like an undocumented
  body-size limit, and it is a hard fail, not a graceful 422.
- Failure is **all-or-nothing**: the oversized batch returned zero answers, so every row in it
  must be retried. A batching adapter must chunk well under the byte wall (target ≤ ~150 KB) and
  treat a whole-chunk failure as retryable.

**Shape 3 cannot fill a column.** One question yields one answer, so N rows produce a single
label (or score). It can express a dataset-level judgment — "which row is the clearest feature
request" (Choice), "how strong is overall demand" (Score), "does this set contain a security
risk" (Noul) — which is a *search lens* over rows, not an AI column. It is also not cheaper per
answer: at N=50 it cost 7,880 tokens for **one** usable value (≈7,880 tokens/value) versus 13,429
for 50 values (≈269 tokens/value). And to let a single Choice discriminate among rows, their text
must be repeated in the criteria descriptions, doubling the row text in the request. Keep it for
"find the best / does this set contain" features, never for filling cells.

### Where it breaks / what is not answered

- **Byte wall, undocumented.** Between 173 KB and 181 KB the request becomes a 400 with no
  partial results. Chunk conservatively.
- **Two questions per row, not one.** The product's real evaluation sends the judgment *and* a
  sufficiency check. This spike measured one question per row; doubling the question count raises
  per-row batch cost (the marginal question is cheap, but the ceiling drops). Expect a real
  ceiling lower than 240 — plan chunks of ~100 rows.
- **Agreement was measured on repeated sample text.** N>35 reuses the 35 rows, which can only
  flatter agreement. The N=100/200 checks show attribution survives repetition; they do not prove
  path-following on 200 *distinct* rows.
- **Partial batch failure was not exercised.** Only the whole-chunk 400 was observed. Whether
  individual malformed answers can coexist with good ones inside a 200 is untested.
- **Baseline latency is sequential.** The 40× is against one call after another; a concurrent
  per-row runner would narrow it, though it would also trip the rate limit the adapter's limiter
  exists to avoid.
