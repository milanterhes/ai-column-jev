# Plan — the task graph

Implementation plan for `proposals.md`. Not a list of steps: tickets with **blocking edges**, so
at any moment there is a frontier of work that can be picked up in parallel.

Convention: `T<n>` ids, `[blocks: …]` names what cannot start until it lands. Effort is `S`
(under a day), `M` (a few days), `L` (a week or more).

---

## Milestone 0 — Correctness

Two diagnosed defects and one policy. Small, and everything else builds on the row shape.

| # | Ticket | Effort | Blocked by |
| --- | --- | --- | --- |
| **T01** | **Structured criteria + state decomposition.** Serialise a question with structured `true`/`false` Noul criteria (`what`, `not_for`, `examples`), and send `state` as an object keyed by sheet headers with questions naming what they inspect by backticked path. | S | — |
| **T02** | **Yes/No via Noul.** Replace the two-option Choice with Noul; label `p >= 0.5`, confidence `|p − 0.5| × 2`. Reverses an earlier decision on new evidence. | S | — |
| **T03** | **Per-type confidence policy.** Document and implement how confidence is derived and thresholded for each type, and what `unable_to_determine` means per type. | S | T01, T02 |

**Acceptance for the milestone:** on the 35-row sample, Yes/No `needs_review` becomes reachable
and `unable_to_determine` falls sharply while the genuinely empty rows (`"help"`, `""`, `"?"`)
stay unusable. Record before/after counts.

---

## Milestone 1 — Fan-out

The unlock. A column becomes a set of atomic questions, evaluated in **one call per row**.

| # | Ticket | Effort | Blocked by |
| --- | --- | --- | --- |
| **T04** | **Schema: column → questions.** `question` table; `result.answers jsonb`; `ai_column.kind` + `composition`. Migration + repos. | M | — |
| **T05** | **Adapter: one request per row.** Build a single Jev request carrying every question for that row; fan answers back out to per-question results. | M | T04, T01 |
| **T06** | **Composite columns.** A composition rule evaluated in code from several answers, with user-tunable weights. | M | T05 |
| **T07** | **Suggestion engine.** Propose three or four adjacent questions when a column is defined; run them speculatively in the same call; offer as keep/discard. | M | T05 |
| **T08** | **UI: question set + weights + components.** Drawer edits a question set; row detail shows per-question answers; composites get a weight editor. | L | T06, T07 |

**Acceptance:** preview latency and token usage stay roughly flat as columns are added. Measure
5 columns × 35 rows before and after. "Add another column" must stop being a cost decision.

---

## Milestone 2 — Measurement

The strategic milestone. It turns corrections from a feature into an asset.

| # | Ticket | Effort | Blocked by |
| --- | --- | --- | --- |
| **T09** | **Agreement from corrections.** For every row a human corrected, compute model-vs-human agreement per column. | S | — |
| **T10** | **The column report.** Accuracy on reviewed rows, a confidence-vs-accuracy curve, the agreement rate, and a sample of disagreements. | M | T09 |
| **T11** | **Saved rules, re-applied.** Save a column definition and apply it to a new upload — the recurring-work path. *Was out of scope; see `direction.md` for why I'd reverse that.* | M | T04 |

**Acceptance:** a user can answer "how good is this column?" with a number, on their own data,
without us making a claim.

---

## Milestone 3 — Reach and quality

| # | Ticket | Effort | Blocked by |
| --- | --- | --- | --- |
| **T12** | **Row-batching spike.** Many rows in one `state`, many questions per row, against the ~32k token budget. The vendor's `semantic_find` cookbook scores 218 items in one request. Decides whether huge sheets get 10x throughput. | M | T05 |
| **T13** | **Escalation path.** Rows Jev is unsure about go to a reasoning LLM with the same criteria, then reconverge. Paid, opt-in, measured. | M | T10 |
| **T14** | **Duplicate / entity-resolution column.** "Which of these rows are the same thing?" The `entity_alignment` cookbook, and a genuinely spreadsheet-shaped pain. | M | T05 |
| **T15** | **Explain this result.** On-demand LLM narrative for a single row, using the stored distribution and the row's own values. *Cut for scope; cheap now and high perceived value.* | S | — |

---

## Milestone 4 — Infrastructure the product assumes

| # | Ticket | Effort | Blocked by |
| --- | --- | --- | --- |
| **T16** | **Queue, fairness, cancel.** `PersistedQueue`, one item per (row, column), per-user round-robin, reserved interactive capacity, cancel flag. Specified in `issues/08-batch-run-semantics.md`. | L | T04 |
| **T17** | **Redis `RateLimiter`** with adaptive feedback, so the limit is learned rather than guessed. Redis is provisioned and idle. | S | — |
| **T18** | **Foreign key** to better-auth's `user` table. Migration order is already correct for it. | S | — |
| **T19** | **Idempotency verification.** Confirm a replayed queue item is harmless once a column carries several questions. | S | T16, T04 |

---

## Milestone 5 — Distribution

| # | Ticket | Effort | Blocked by |
| --- | --- | --- | --- |
| **T20** | **Google Sheets / Airtable sync.** The deferred effort, charted in `issues/17-sync-with-live-sheets.md`. Scheduled pull before webhooks. | L | T11, T16 |

---

## The graph

```
T01 ─┬─► T03
      └─► T05 ─┬─► T06 ─► T08
T02 ──┴──► T03  ├─► T07 ─► T08
                ├─► T12
                ├─► T14
                └─► (T04) ─► T16 ─► T20
T04 ─────────────┴─► T11 ─────────┘
                     T09 ─► T10 ─► T13
T15, T17, T18 ── independent
```

## The frontier right now

**T01, T02, T04, T09, T15, T17, T18** — seven tickets with nothing blocking them, spanning
correctness, schema, measurement and infrastructure. T04 is the longest pole; start it first so
T05 and T16 can begin.

## Two things to decide before starting

1. **Does T04 land before T16, or in parallel?** The queue wants the question table; the question
   table does not want the queue. Doing T04 first avoids writing the queue against a schema that
   is about to change. I would sequence T04 → T16.
2. **Is `proposals.md` 2.1 the right bet?** It is a large change to the core noun of the product.
   If the answer is no, Milestones 0 and 2 still stand alone and are cheap.


---

## Status

**Done and verified.**

| # | Ticket | Evidence |
| --- | --- | --- |
| T01 | Structured criteria + state decomposition | False unusables fell 4 → 1; the `not_for` branch is what did it |
| T02 | Yes/No via Noul | Confidence went from saturated (6 distinct values, 0.59–1.00) to graded (17 distinct, 0.51–0.96) |
| T03 | Per-type confidence policy | `defaultThresholdFor` — 0.6 for Noul, 0.8 for Choice/Score. **Not the original plan:** Noul's confidence is the selected answer's probability, not `\|p−0.5\|×2`, because Jev's Noul probability is compressed toward 0.5 and the transformed scale read as "30% confident" on the clearest positive in the set |
| T09 | Agreement from corrections | In the report |
| T10 | The column report | `/datasets/:id/columns/:cid/report` + a Report tab |
| T21 | Random audit | `markAuditSample`; the report states plainly that it is the only unbiased number |
| T16 | Queue, fairness, cancel | `@app/queue`: per-user per-class queue names, round-robin claim loop, reserved interactive slots, cancel-first handler, retryable/terminal split. Runs async end to end — 35 rows drained in under 8s while the request returned instantly |
| T17 | Rate limiter | Not done. Redis is provisioned and idle |
| T18 | Foreign key to `user` | Not done |
| T19 | Idempotency | Proven by construction: results upsert on (ai_column_id, row_id) and queue ids are deterministic |
| — | Unit tests | 26 tests on the evaluation core |
| — | Harder eval fixture | `eval/hard-cases.{tsv,csv,md}` — 24 arguable cases, because E4 could not be answered on the easy fixture |

**Bugs found and fixed along the way.**

1. **Noul discarded the provider's own confidence** (found by the test agent). One line, and it defeated the point of storing it for comparison.
2. **The queue's `id` is `varchar(36)`** — sized for a UUID. A readable `scope:column:row` key is 110 characters and every insert failed. Now a deterministic SHA-256 prefix, so replay dedupe still works.

**Not done.**

- **T04/T05 — fan-out.** Still one question per column, one call per row. This is the milestone that makes the second column nearly free, and it is unstarted. It is also the largest change and wants a clear head.
- **T06–T08** depend on T04/T05.
- **T11** saved rules. **T12** row-batching. **T13–T15.** **T20.**
- **Preview still evaluates inline.** The spec says it should go through the queue as interactive-class work. At ten rows it is fast enough that this has not bitten, but it is a deviation.

**One design flaw, stated rather than hidden:** an audit row the user *ignores* currently counts as agreed, which inflates the estimate. The report says so and calls the figure an upper bound. Fixing it properly needs an explicit confirm action on audit rows.
