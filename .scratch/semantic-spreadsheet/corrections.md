# Corrections — what they are for, and whether Jev can learn from them

Answers two questions directly, because the second one determines what we build.

---

## 1. Can we pass corrections back to Jev?

**Not as training.** There is no fine-tuning endpoint, no feedback API, no per-account state. The
entire surface is `POST /v1/systemone` with a `state` and a map of `questions`. Jev is stateless:
every call is independent, and it never learns anything from us.

**But yes, as few-shot examples — and the docs confirm the mechanism.**

Every one of these fields accepts `string | object | array | null`:

| Field | Applies to |
| --- | --- |
| `instructions` | Choice, Score, Noul |
| `criteria` values | Choice option descriptions |
| `criteria` entries | Score level descriptions |
| `criteria.true` / `criteria.false` | Noul |

A Choice option can carry `what`, `not_for` and `examples`; a Noul's `true` and `false` branches
can each carry `what` and `examples`; a Score level can carry `summary` and `signals`. Those
`examples` arrays **are** few-shot exemplars, encoded in the question definition:

```jsonc
"criteria": {
  "true": {
    "what": "Asks for something the product cannot do yet",
    "examples": ["Please add a Slack integration", "We need SAML SSO"]
  },
  "false": {
    "what": "Anything else, including reports of broken behaviour",
    "not_for": "A bug report — absence of a feature request is not an unknown",
    "examples": ["Login is bouncing me back to the sign-in page"]
  }
}
```

So corrections *can* re-enter the model. They just re-enter as **prompt content**, not as weights.

### Three consequences that matter

1. **Examples are per-column, not per-row.** They live in the criteria, which is shared across
   every row. You cannot whisper "and this one is like that row you corrected" — you can only
   give a handful of representative exemplars that apply to all of them.
2. **You pay for them on every call.** Examples inflate every request's token count. With per-row
   calls that is N × example tokens; with row-batching it is once per batch. **Another argument
   for row-batching.**
3. **They compete with the state for the budget.** The ~32k token allowance is shared between
   state and questions. Batching rows *and* adding examples squeezes both.

---

## 2. What corrections are actually for

Five purposes. Ordered by how real they are today.

### a. They are the answer — *works today*

The human's judgment is what the cell should contain. The model's value is preserved, but the
**effective value** is the correction. This is the primary purpose; everything else is secondary.

### b. They empty the review queue — *works today*

A corrected row leaves the queue. Operational hygiene, not strategy.

### c. They are the only ground truth we have — *strategic, needs building, and needs no Jev*

This is the one that matters commercially. They let us compute:

- **Agreement** — how often the model matched the human, per column.
- **A confidence-vs-accuracy curve** — bucketed by confidence, measured on real rows.
- **An unbiased accuracy estimate**, once paired with a *random* audit.

Note that none of this involves Jev at all. It is our own analytics over data we already store.
It is also the thing that makes the product sellable, because "how accurate is this column?" is
the first question a serious buyer asks.

### d. They tune the thresholds — *needs building, no Jev*

Where do humans disagree? At what confidence? That is precisely the "measure on your own data"
the TypeSafe docs recommend, and corrections are where the data comes from. A per-column
threshold should be *derived* this way rather than set to 0.8 by us.

### e. They encode the house definition — *the only path back into Jev*

When a user corrects "we count marketplaces as B2B SaaS", that is not the model being wrong about
the world; it is the user's definition differing from the default reading. That is exactly what
`examples` are for.

**Corrections do not make Jev smarter. They make Jev agree with you about your edge cases.**

---

## 3. The levers for improving the next run, ranked

1. **Sharpen the criteria.** When you see a cluster of disagreements, the fix is nearly always a
   better definition — a `what`/`not_for` boundary, a contrapositive example — not more data. This
   is the biggest lever and the cheapest.
2. **Add boundary examples.** Best when the user's definition is idiosyncratic. A handful of
   well-chosen exemplars, not a dump.
3. **Escalate uncertain rows** to a reasoning LLM with the same criteria.
4. Nothing else. There is no fourth lever.

---

## 4. The traps

- **Review is not a random sample.** People review uncertain rows first. Feeding *only corrected
  rows* back as examples teaches Jev about your hard cases and can skew it on the easy ones. Draw
  exemplars from a balanced set — some confident-and-correct, some corrected — not just from the
  corrections table.
- **Over-anchoring.** Enough examples and the model pattern-matches the examples instead of the
  definition. Keep them few and boundary-focused.
- **You cannot know a change helped without a held-out set.** Without one, "did refining the
  criteria improve things?" is unanswerable, and prompt-tweaking becomes superstition.
- **Silent drift.** If criteria can change, results computed under different criteria are not
  comparable — and averaging them into one accuracy number is meaningless.

---

## 5. What this means for the design

Five consequences, and they are the reason to settle this before planning.

1. **Criteria must be versioned.** Every result records the criteria version that produced it.
   Without this, the accuracy number mixes incomparable runs.
2. **Corrections record the criteria version they were made under** — not to gate the effective
   value (a human's judgment still stands), but to keep *measurement* honest.
3. **The threshold belongs to a (column, criteria version) pair**, not to a column. Refining the
   criteria invalidates the threshold.
4. **A held-out set is load-bearing**, not a nice-to-have. It is the random audit (T21), and it is
   the only way to know whether a criteria change helped.
5. **The refinement loop goes through the human.** Corrections cluster → we propose a sharper
   definition (using the LLM path already wired for rule clarification) → the user accepts → we
   re-measure on held-out rows. That is the real "corrections improve the next results" loop, and
   it is honest, because a person approves every change to the definition.

### What does *not* change

The earlier decision stands: a correction is anchored to the *(AI column, row)* pair and survives
re-runs, because a human's judgment about a row does not expire when the model is asked a
different question. Measurement filters by criteria version; the effective value does not.
