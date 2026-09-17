# Rule clarification

**Type:** grilling
**Status:** resolved
**Assignee:** milanterhes
**Blocked by:** —
**Ratification:** ⚠️ **PROVISIONAL — agent-decided under explicit delegation while the human was asleep. Not ratified by a human. Review on waking.**

## Question

Decide the one in-scope LLM behaviour: turning a vague user instruction into cleaner evaluation criteria *before* the first preview (Q8=B).

Settle:

- **When it fires.** Automatically on blur, on an explicit "improve this" affordance, or never automatically. What the user sees and can accept or reject.
- **What it produces.** A rewritten instruction only, or a rewritten instruction plus suggested labels (the brief mentions suggesting category labels).
- **What the user controls.** Whether accepting a suggestion is explicit, whether the original wording is recoverable, and whether an unaccepted suggestion is ever used.
- **Context.** Whether existing column names are used to suggest example prompts, and how the brief's "contextual example prompts based on existing column names" is generated.
- **Failure and cost.** What happens when the LLM is unavailable or returns something unusable, and whether this path is feature-flagged.
- **Boundary.** Confirm this never evaluates rows and never runs during a batch — it only shapes the column definition.

## Answer

> ⚠️ **PROVISIONAL — decided by the agent, not the human.** The human was asleep and explicitly delegated. Treat as a draft for review, not a settled decision.

**It fires only on an explicit affordance — "Improve this" — never automatically.** Rewriting a user's words on blur, without consent, and spending tokens to do it, is surprising in the bad way. The user asks; the model answers.

**It produces a rewritten instruction, and nothing else by default.** For a Category column a second, separate affordance suggests labels — kept separate because suggesting labels *and* rewriting the instruction are two different asks, and bundling them makes both harder to refuse.

**Acceptance is explicit and recovery is real.** The suggestion appears as a diff-like draft the user must accept; the original wording is retained in the field's history so a single action restores it. **An unaccepted suggestion is never used anywhere** — not stored on the column, not sent to Jev.

**Context comes from the dataset's own column headers.** The drawer reads the uploaded dataset's headers and asks the model for three example questions grounded in those names — the brief's "contextual example prompts based on existing column names". These are suggestions in the instruction field's placeholder area, not auto-filled text, so nothing is written without an action.

**Failure is silent and cheap.** If the LLM is unavailable, times out, or returns something unusable, the affordance reports that it couldn't help and the user's text is untouched. The whole path is **feature-flagged and off unless a provider key is present**, so the core loop never depends on it.

**Boundary, stated as a rule: this never evaluates a row.** It shapes a column definition before any evaluation exists. It is not called during preview, not during a batch run, and not on a result. The provider is a general-purpose LLM (OpenAI, whose key is present), deliberately kept separate from Jev — per the map's standing constraint that a general-purpose LLM is never the default row evaluator.
