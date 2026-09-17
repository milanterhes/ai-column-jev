# Export shape for the slice

**Type:** grilling
**Status:** resolved
**Assignee:** milanterhes
**Blocked by:** 05
**Context:** inherits from **One result shape across the three column types** — the selected value is a label name (never a fractional score), the distribution and both confidences are stored, and the four-value status exists; and from **Corrections layered over model output** — export reads the **effective value**, with the model's own value optionally alongside

## Question

Decide exactly what a CSV export contains, and in what order.

Settle:

- Which columns: the original columns verbatim and in original order, then for each AI column the result, and whether a confidence column is emitted by default or optionally.
- Column naming for the AI columns and their confidence companions, including collisions with original headers.
- Whether the export carries the model value or the human-corrected value when a correction exists, and whether both can be carried.
- Whether failed or "unable to determine" rows are exported, and what their cell contains.
- Whether exports include any usage or provenance columns.
- Row ordering and header normalisation guarantee: the brief requires original row ordering preserved.

XLSX export is out of scope for this map.

## Answer

**Layout.** The original columns **verbatim and in their original order**, then for each AI column, in creation order: its **value**, then its **confidence**. Confidence columns are **on by default**, with a single toggle for the whole export — exporting a judgment while hiding how sure the model was is the one thing this product promises not to do, and one switch turns it off for anyone who wants the narrow sheet. *(Rejected: interleaving each AI column beside the original column it was derived from, which reads well until a source column is reordered and the mapping silently changes.)*

**Column naming.** The AI column's name is the header, verbatim; its confidence companion is `<name> Confidence`. On collision with any other emitted header — an original column or another AI column — the later one gets a numeric suffix (`B2B SaaS (2)`, `B2B SaaS (3)`). Deterministic, and nothing is ever silently overwritten.

**Rows with no answer: two columns, self-describing.** The value cell carries the label, or the words **`Unable to determine`** / **`Failed`**; the confidence cell is blank for those rows. No third status column. A blank value cell would be genuinely ambiguous — in a partially-run dataset it could mean "not evaluated yet" or "couldn't be evaluated", which are different facts — and writing the status word makes the export explain itself with no extra width. **Accepted trade-off, recorded deliberately: the value column mixes labels with two status words**, so a downstream consumer filtering it must expect that. This does not weaken the closed-label-set rule from **Corrections layered over model output**, which governs *corrections*, not export.

**Confidence format: a plain decimal**, rounded to two places — `0.72`. Unambiguous, sorts correctly everywhere, needs no locale handling, and can be formatted as a percentage in one click by the user. A spreadsheet user can turn `0.72` into `72%`, but cannot un-stringify `"72%"`.

**Corrections: the effective value only.** The export is the finished dataset, and the human's answer *is* the answer. The model's overridden value is not emitted — it is fully retained in the product, which is where that comparison belongs. An opt-in extra column carrying the model's value is an obvious later addition, deliberately not taken now: it would triple the width of a wide sheet to serve a case nobody has asked for.

**All rows, always, in original row order** — regardless of the table's current filters or sorting. The brief says export *the enriched dataset*, not the view, and "everything, in the order you gave it to me" is a promise a user can rely on without checking invisible state. This is flagged as the most likely thing to revisit: exporting the current filtered view is a real candidate for a follow-up, but it makes one button behave differently depending on unseen state and would break the original-ordering guarantee.

**Format.** RFC 4180 CSV, UTF-8, one header row, cells containing commas or newlines quoted. **No usage or provenance columns** — the run's usage lives in the product, not in the user's data. No added row-index column; the user's sheet already carries whatever identifies its rows.

XLSX export remains out of scope for this map.
