# Table behaviour in the slice

**Type:** grilling
**Status:** resolved
**Assignee:** milanterhes
**Blocked by:** —
**Context:** `issues/15-adopt-scaffold-base.md`; inherits from **Corrections layered over model output** — a corrected cell must be visually distinct from a computed one, and the model's raw value is reachable

## Question

Decide what the spreadsheet view must do in the slice — the brief lists more capability than a first slice needs.

Settle, as product behaviour:

- Which of these are in: horizontal scrolling, sorting, filtering, filter by semantic result, filter by confidence, hide/show columns. If any are dropped, say what the user does instead.
- What sorting by a semantic column means — by selected value, or by confidence, or both.
- What "filter by confidence" offers the user given the three buckets: a bucket filter, a numeric threshold, or both.
- How filters combine (AND), and whether filters persist across a reload.
- What a semantic cell shows by default, and what it reveals on hover or click without overwhelming the UI with probability vectors.
- How semantic columns are distinguished visually from original columns, and how a corrected cell is distinguished from a computed one.
- Whether the table is paginated or virtualised, and what happens with 8,000 rows.
- **What we inherit:** the base ships shadcn/ui on **Base UI** (not Radix) and exactly four components — `button`, `table` (a plain styled `<table>`), `pagination`, `native-select`. There is **no grid, no virtualisation, no dialog, no form library, no client-side validation**. So decide which of this ticket's behaviours are achievable with a hand-built table and which force a grid library — and if a library, name it, since that is the one UI choice the spec leaves open. State the constraint the spec must carry.

## Answer

**Ratified in conversation** ("these all sound great") before the human retired.

**Grid: TanStack Table (headless) + TanStack Virtual**, rendered with the base's own `table.tsx` and Tailwind, giving continuous spreadsheet-style scrolling with **no pagination**. Both libraries are headless and unstyled, so they compose with Base UI rather than fighting it, and they are siblings of the TanStack Router and Query already in the stack. This is the **one UI choice the destination left open, now named.** 8,000 rows × ~10 columns is 80,000 cells, which cannot all render, so it was virtualisation or pagination — and only one of those looks like the product. *(Rejected: pagination with the base's existing component — a paginated table with a pager bar is a database table, not a sheet, and the brief is explicit that the spreadsheet must dominate. Rejected: a full data grid such as AG Grid, which buys features we would spend a week switching off.)*

**All six listed behaviours are in**: horizontal scrolling, sorting, filtering, filter by result, filter by confidence, hide/show columns. With TanStack Table, sorting and column visibility are configuration rather than code.

**Sorting a semantic column:** by **value** *and* by **confidence**, both offered from the column header. Crucially, **a Score column sorts by level order, not alphabetically** — its value is an ordered level, and alphabetical would put "Excellent fit, Good fit, Poor fit, Weak fit" in an order no human means. Category and Yes/No sort alphabetically.

**Filter by confidence means the four status buckets**, never a numeric slider. The user's mental model *is* those four concepts, and a slider exposes a raw number the user has no basis to choose before seeing how confidence distributes on their own data. It is also redundant: the buckets are derived from the threshold, so a slider is the threshold wearing a different hat.

**Filters combine AND across columns, OR within one column's multi-select**, and **persist in the URL** via TanStack Router search params — reload survival and shareable links come free, which matters because "needs review" is a view a user will want to hand to someone else.

**A semantic cell shows the value, a small confidence percentage, and a ⚠ for needs-review** — never probability vectors inline. **Clicking opens a row-detail panel** showing the input values, the selected answer, the confidence, the distribution, and the model's original value where a correction exists. The panel is **in scope**: it is where the distribution actually gets shown, and the product's promise is preserving uncertainty, which a percentage in a cell cannot carry alone. It is also where corrections are made, so the review workflow needs it regardless. **No LLM "Explain result" button** — out of scope.

**Visual language: a tinted header for the AI column block plus a single vertical rule** separating originals from AI columns. No icons, no sparkles — it reads as one sheet with two zones rather than two products stapled together, and it survives horizontal scrolling.

**A corrected cell renders normally with a small, persistent edited marker**, with the model's original value in the detail panel. The marker must **not** be hover-only: **Corrections layered over model output** established that a corrected cell must never be mistaken for fresh model output, and a hover affordance is invisible in a screenshot or on a shared screen.

### Handed to other tickets

- **Stand up the stripped base** must add `@tanstack/react-table` and `@tanstack/react-virtual`, and generate the dialog, input, and select components the base does not ship.
