# One result shape across the three column types

**Type:** grilling
**Status:** resolved
**Assignee:** milanterhes
**Blocked by:** 01
**Context:** `research/jev-api.md`; inherits decisions from **What confidence means** — a computed confidence field plus Jev's raw `confidence`, the per-column `0.8` threshold in configuration, the four states, the two-question evaluation shape, and the discarded-judgment rule

## Question

Decide the canonical internal representation shared by all three user-facing column types — **Yes/No**, **Category**, **Score** — so the domain model is one thing, not three.

Settle, in domain-model terms, with Jev's real response shape in hand:

- What a *column definition* is: name, type, instruction, and the type-specific configuration (the label set for Category, the ordered levels for Score, the implicit two labels for Yes/No).
- What a *result* is: the selected value, the distribution over all candidate labels, a confidence, a status, the raw provider response for debugging.
- Whether Yes/No and Score are simply constrained Category columns with a fixed or ordered label set. If they are, say so plainly and let the type be a rendering and validation concern. Note that Jev's three primitives do not line up one-to-one with the three user-facing types: Choice maps to Category *and* to Yes/No, Score is ordinal, Noul is the bare binary. Decide the mapping.
- Score questions come back as a probability-weighted value that can fall *between* levels (e.g. `1.035` on a 0/1/2 scale), not just a level index. Decide what the stored "selected value" is for a Score column, and what the cell displays.
- How a distribution is stored and read back, without duplicating giant blobs (the brief warns against this).
- Which vocabulary is canonical and belongs in `CONTEXT.md`: AI column, evaluation, result, status, correction.

This is the decision the corrections model, the export shape, and the evaluation-service boundary all hang off.

## Answer

**One shape, not three.** A column carries a **label set** — each label a name plus an optional description — an `ordered` flag, and a `type` tag that exists only for rendering and validation. The three user-facing types are therefore presentation, not architecture:

| User-facing type | Labels | Jev primitive |
| --- | --- | --- |
| **Yes/No** | two fixed labels | Choice |
| **Category** | N labels, unordered | Choice |
| **Score** | N labels, ordered | Score |

**An AI column** holds: its name, its type, its instruction, its label set (name + description per label, matching Jev's `option → description` Choice contract), the `ordered` flag, and `needsReviewThreshold` (defaulting to `0.8`, per **What confidence means**).

**A result** holds:

- **selected value** — the label name.
- **distribution** — label name → probability, in `jsonb`.
- **confidence** — the winner's share, computed by us.
- **provider confidence** — Jev's own `confidence`, kept for later comparison, nullable.
- **status** — one of the four states.
- **detail** — type-specific extras; for Score, Jev's fractional weighted value.
- **provider response** — a **trimmed projection** (the answers plus token usage), stored on **every** row, never the full HTTP envelope.
- **row id** and **AI column id** — the anchors.

**For Score, the stored value is the argmax level label** — "Good fit" — with Jev's fractional `1.035` retained as a detail and surfaced in the row-detail view. The cell shows the label. This keeps sorting, filtering, and export behaving exactly like Category, so the Score type costs the rest of the system nothing. *(Considered and rejected: making the fractional number the value, which nothing downstream could sort or group sensibly.)*

**Rows live in Postgres**, one row per spreadsheet row, original values in `jsonb`, results joined by row id — **and the original uploaded file is archived in object storage**. Results need a stable anchor to join, filter, and export against, and re-parsing the file on every read would be a permanent liability for a product whose entire interface is that table. The archive is what lets us prove what the user actually uploaded.

**Canonical vocabulary**, to be written into `CONTEXT.md`:

- **AI column** — drops "semantic"; the user never sees that word, and two names for one thing is how glossaries rot.
- **Result** — one row evaluated against one AI column.
- **Evaluation** — *not an entity*. It is only the unit of account, a count. No table.
- **Status** — `high_confidence | needs_review | unable_to_determine | failed`. *Accepted trade-off: naming these after the user-facing concepts couples stored data to UI copy.*
- **Correction** — a human override; shape settled in **Corrections layered over model output**.

### Handed to other tickets

- **Corrections layered over model output** and **Export shape for the slice** are both unblocked by this.
- **The evaluation-service boundary** inherits the primitive mapping: Yes/No and Category → Choice, Score → Score; plus the label-set shape as the input to Jev's `option → description` map.
- **Dataset privacy and lifecycle** inherits: rows are `jsonb` in Postgres *and* the original file is archived, so deletion must cover both.
