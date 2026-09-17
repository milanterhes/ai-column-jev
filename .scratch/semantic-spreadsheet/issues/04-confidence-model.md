# What confidence means

**Type:** grilling
**Status:** resolved
**Assignee:** milanterhes
**Blocked by:** 01
**Context:** `research/jev-api.md`

## Question

Decide what the confidence number *means* to a user, and how it maps onto the three user-facing concepts — **High confidence**, **Needs review**, **Unable to determine**.

Settle:

- What the underlying number is: a calibrated probability of the selected answer, a margin between top two options, something else. Jev returns a full distribution over your options for Choice and Score, plus a `confidence` it derives from the distribution's shape; it exposes the raw distribution precisely so you can compute your own measure. Decide whether we use Jev's derived `confidence` or compute our own from the distribution.
- **The binary hole:** Noul (Yes/No) returns a bare probability and **no `confidence` field at all**. Decide how a Yes/No column gets the same user-facing confidence concepts as Category and Score — derive it from the probability, or treat Yes/No differently.
- Whether the spec promises calibration. Jev claims it; no reliability curve is published. Decide whether the spec may say "98% means 98% likely", or must instead say confidence is a relative, thresholded signal.
- Whether the three concepts are derived from the number plus a threshold, or whether "Unable to determine" is a distinct provider outcome that no threshold produces.
- The default "needs review" threshold, and how it is stored so it can be made configurable later (the brief allows configuring it later, not now).
- What a cell displays for each concept: value + small confidence indicator, and where "⚠" appears.
- What confidence means for a **Score** column (an ordinal level) and a **Category** column (a distribution), not just Yes/No.
- The rule that the spec must preserve the real numeric value internally even when the UI shows a bucket.

## Answer

**What the number is: the winner's share of the distribution.** Confidence is *the probability mass Jev put on the answer it selected* — `72%` when the breakdown reads `B2B SaaS 72%, Consumer 11%, Agency 9%, Marketplace 5%, Other 3%`. We compute this ourselves from the returned distribution rather than using Jev's derived `confidence`, for three reasons: it is one definition that means the same thing for Category and for Score; it is a pure, testable function of data we already store; and it does not depend on a vendor derivation Jev leaves undocumented. **We also store Jev's `confidence` verbatim** so that "is Jev's number better than ours?" becomes answerable from our own data later. The margin between the top two options was considered and rejected — it is the sharper triage signal but far harder to explain in a cell.

**The binary hole is erased, not patched.** A Yes/No column is modelled as a **two-option Choice** — labels `Yes` and `No`, each with a description — rather than Noul. It therefore returns a genuine distribution and takes the identical confidence path as Category and Score. Nothing in the storage, thresholding, or rendering layers special-cases binary. Noul is left unused in the slice, in reserve for a future proposition-shaped question. *(This settles the primitive mapping for the binary case; **One result shape across the three column types** inherits it.)*

**Four states, four different user actions.** "Unable to determine" is an **input** state, not a model state: *we could not evaluate this row because the data needed isn't there.* It is distinct from low confidence and distinct from failure.

| State | Meaning | User action |
| --- | --- | --- |
| **High confidence** | Answered, at or above the threshold | None |
| **Needs review** | Answered, below the threshold | Judge the model's answer |
| **Unable to determine** | The input was insufficient to judge | Fix the row's data |
| **Failed** | The evaluation errored | Retry |

**Sufficiency is detected by the model, not mechanically.** Every evaluation sends a second **Noul** question alongside the judgment — *"is there enough information in this state to answer X?"* — and a false answer marks the row unable-to-determine. Chosen over a mechanical empty-cell pre-check because it also catches rows that are non-empty but too thin to judge. Jev evaluates all questions in one call and adding questions barely changes latency. **Note the deliberate split:** the state *means* an input problem, but a model *decides* when it applies — so the spec must not claim this state is infallible.

**When sufficiency fails, the judgment is discarded.** The row reads "Unable to determine"; the judgment's answer is retained only inside the raw provider response for debugging, and is not a result. Showing a low-information guess as a cell value is exactly the "pretending every answer is equally reliable" failure the brief forbids.

**The threshold is per-column, default `0.8`, editable from the start.** It lives in the column's configuration object, pre-filled with the app default, and the user can override it per AI column. Per-column is chosen over a per-user global setting because the need is per-column (a churn-risk judgment and a category sort want different tolerance) while a global threshold invites arbitrary choices. The threshold applies to the winner's share.

**The spec may not claim calibration.** Confidence is a **relative, thresholded signal**: "the model's own certainty; higher is more reliable; below the threshold it asks for review." The spec must never say `0.9` means 90% likely correct. Jev asserts calibration (RLCD) but publishes no reliability curve — anything stronger requires an empirical measurement on our own labelled rows.

**Internally the real number is always preserved**, even when a cell renders only a bucket.

**Unit of account is unchanged.** *One row × one AI column = one evaluation*, regardless of how many Jev questions it fans out to internally. N questions-per-evaluation is recorded as an internal cost detail rather than surfaced as a second unit.

### Handed to other tickets

- **One result shape across the three column types** inherits: a computed confidence field *plus* Jev's raw `confidence`; the per-column threshold in configuration; the four states; and the discarded-judgment rule.
- **The evaluation-service boundary** inherits: two questions per evaluation (one Noul sufficiency check, one judgment), and the requirement that the sufficiency answer and the judgment travel together.
- **Batch-run semantics** inherits: the completion summary's "unable to determine" count is distinct from both "needs review" and "failed".
