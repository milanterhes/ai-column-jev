# Proposals — what to change, and what to build next

Grounded in `.scratch/semantic-spreadsheet/research/jev-capabilities.md` and what the running
product already does. Ordered by leverage, not by size. Each item says what it changes, why now,
and how we'd know it worked.

---

## The one-line thesis

**In this product, the second column should be nearly free — and today it costs full price.**

Jev evaluates every question in a request in parallel, and the vendor's own cookbook measures
batching 13 questions into one call at **12.2x cheaper and 10x faster** than 13 calls, with
unchanged answers. We call Jev once per row *per column*. A user with five AI columns pays five
times. That is the largest gap between what we built and what the platform provides, and closing
it is both a cost story and a product story ("add another column, it's almost free") — which is
exactly the behaviour we want a spreadsheet product to have.

---

## Phase 1 — Correctness. Small, and two of these are diagnosed bugs.

### 1.1 Fix the sufficiency question with structured criteria

**Problem.** A clear bug report scores low on *"is there enough information to answer: is this a
feature request?"* because the **absence** of feature-request content reads as missing
information. That is why the Yes/No column discards 11 of 35 rows.

**Change.** Noul accepts criteria as a structured object with explicit `true` and `false`
branches, each carrying `what`, `not_for` and `examples`. Define what "No" means — including
what it is *not for* — so absence becomes a defined answer rather than an unknown.

```jsonc
{
  "type": "noul",
  "instructions": { "question": "Is this asking for functionality that does not exist yet?",
                    "inspect": "`subject` and `message`" },
  "criteria": {
    "true":  { "what": "Asks for something the product cannot do yet",
               "examples": ["Please add a Slack integration"] },
    "false": { "what": "Anything else, including reports of things that are broken",
               "not_for": "A bug report — absence of a feature request is not an unknown",
               "examples": ["Login is bouncing me back to the sign-in page"] }
  }
}
```

**Effort.** Small — a change to how we serialise a column into a question, plus per-type criteria
editing in the drawer.

**How we'd know.** `unable_to_determine` on the sample CSV should drop sharply for the Yes/No
column while the genuinely empty rows (`"help"`, `""`, `"?"`) *stay* unusable. Re-run the 35-row
sample and compare.

### 1.2 Yes/No should use Noul, not a two-option Choice

**Problem.** We chose a two-option Choice to give Yes/No a distribution. But a binary Choice
collapses: every judged row in the sample came back 0.96–1.00, so `needs_review` is unreachable
for the most common column type.

**Change.** Use **Noul** for Yes/No and treat its probability as the graded signal. The evidence
is already in our own data: on the same rows, Noul returned `0.58`, `0.44`, `0.09` — real spread
— where Choice returned `1.00`. Define the label as `p >= 0.5` and the confidence as
`|p − 0.5| × 2`, which is symmetric and reads the same for a confident Yes and a confident No.

**This reverses an earlier decision**, on evidence we did not have when we made it.

**Effort.** Small — one primitive mapping in the adapter, plus the confidence formula.

**How we'd know.** `needs_review` should become reachable on a Yes/No column, and the confidence
histogram should stop being a spike at 1.0.

### 1.3 State decomposition — point questions at fields

**Problem.** We flatten the whole row into one text blob and send it as `state`. Jev's guidance
is to decompose the state and reference fields by a backticked dot-index path, so a question
cannot be confused about which part it is judging.

**Change.** Send `state` as a structured object keyed by the sheet's own headers, and have each
question name the fields it inspects (`"inspect": "`subject` and `message`"`). This is also a
prerequisite for 2.1 — a composite needs its questions pointed at different parts of the row.

**Effort.** Small, and it makes the adapter's inputs better typed.

**How we'd know.** Fewer `unable_to_determine` rows, and better row-detail explanations ("looked
at `message`") for free.

---

## Phase 2 — The unlock: a column becomes a *set* of questions

### 2.1 One call per row, for every question on that row

**Change.** Replace "one AI column = one question" with **"one AI column = a set of atomic
questions"**. A 35-row sheet with five columns becomes **35 Jev calls, not 175**.

This is a schema change, and it is the important one:

```
ai_column   (… name, kind: 'single' | 'composite', composition jsonb)
question    (id, ai_column_id, key, type, instructions, criteria jsonb)
result      (… selected_value, composite_value, answers jsonb, …)
```

`result.answers` holds every question's typed answer for that row; `selected_value` is the
column's headline value.

**Effort.** Large — schema, adapter, preview/run, export, and the drawer all move.

**How we'd know.** Preview latency and token usage should be roughly flat as columns are added.
Measure: 5 columns × 35 rows, before and after.

### 2.2 Composite columns

**Change.** A column whose value is composed **in code** from several atomic answers, with
weights the user controls:

```
quality = 0.4 × fits_industry + 0.4 × right_size + 0.2 × buying_signal
```

The user sees the components *and* the composite, and tunes weights rather than rewriting a
prompt. This is the vendor's Composite Scoring pattern and it directly fixes the opacity of our
Score columns — today a Score column gives one number with no way to see or adjust what it
weighed.

**Effort.** Medium, on top of 2.1 — a composition rule, a weight editor in the drawer, and
component breakdowns in the row-detail panel.

**How we'd know.** A composite ICP column on the sample data should let a reviewer disagree with
the *weights* rather than with the model.

### 2.3 Speculative suggestions

**Change.** When a user defines a column, also ask the three or four adjacent questions that
almost always go with it, in the same call, and offer the answers as extra columns they can keep
or discard. "Is this a feature request?" comes with "is it a bug?", "is it urgent?", "is there
churn risk?" — all priced at the tokens for the extra questions.

This is Speculative Fan-Out, and it replaces the out-of-scope template gallery with something
much better: the suggestions come from *their* sheet, not from a catalogue.

**Effort.** Medium — a suggestion prompt (LLM-assisted, our existing rule-clarification path) and
a keep/discard UI after preview.

**How we'd know.** More columns per dataset, and a shorter path from upload to first value.

---

## Phase 3 — New column capabilities the primitives already allow

### 3.1 Confidence-graded taxonomy columns

Report the **fine-grained** answer when confident and fall back to the **broader** category when
not — instead of binning everything uncertain into "needs review". The vendor has a cookbook for
exactly this (75 industry groups, falling back to the division above). For a spreadsheet it means
a category column that degrades *usefully*.

### 3.2 Deep taxonomies

Our Category is capped by Jev's 255-option Choice limit. Hierarchical classification via beam
search over probabilities gets deep trees — industry taxonomies, product categories, legal
clauses. Worth doing when a user asks for a taxonomy we cannot fit in one Choice.

### 3.3 Verification columns

A column that checks another. "Does this row's `claim` match its `source`?" — citation-checking
applied to a sheet. Natural for anyone using AI columns to produce something they then have to
trust, and the first column type whose *input* is another column's output.

### 3.4 A ranking lens

Not a per-row judgment at all — a different mode over the same sheet: *"order these 400 rows by
relevance to this query"*, or *"which rows match this description"*. Uses Score or Choice per
candidate, run over the sheet rather than a column. This is the Search/Ranking decision shape,
and it is a genuinely new surface rather than another column.

---

## Phase 4 — Infrastructure the product already assumes

These are known gaps, not proposals. They should be done before any of Phase 3.

1. **Wire the queue.** `run` evaluates inline today, so a large sheet makes a slow request and
   there is no cancel. `PersistedQueue`, one item per (row, column), per-user fair scheduling,
   and cancellation via a run flag are all specified in `issues/08-batch-run-semantics.md`.
2. **Wire the Redis `RateLimiter`** with adaptive feedback, so the limit is learned rather than
   guessed. Redis is running and idle.
3. **Add the foreign key** to better-auth's `user` table. The migration order is already correct
   for it.
4. **Row-level idempotency.** The queue is at-least-once and Jev documents no idempotency, so a
   replayed item must be harmless. Results already upsert on (column, row); confirm that holds
   once a column can carry several questions.

---

## Explicitly not now

The research turned up a lot we *could* build. These are crowded, and none of them is our wedge:

- **Guardrails / moderation / jailbreak detection** — well-funded incumbents, and it is a
  different buyer.
- **RAG passage classification and re-ranking** — a developer tool, not a spreadsheet.
- **Agent harness work** (skill suggestion, tool-call verification) — interesting, adjacent, and
  a different product entirely.
- **Feature-matrix export for downstream ML** — genuinely interesting, but it needs a
  data-science buyer we do not have and would pull the product away from the spreadsheet.

---

## If only one thing gets built

**2.1.** Everything else is a feature; that one is the reason to use this platform. It turns the
product's economics from "each column costs more" into "each column costs almost nothing", and it
is the precondition for composites, suggestions, and verification columns.

If only one *week* is available, do Phase 1 — it is small, it is diagnosis-driven, and two of its
three items fix defects that are visible in the demo today.
