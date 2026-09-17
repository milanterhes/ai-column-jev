# Sync AI columns with live Google Sheets and Airtable

**Type:** grilling
**Status:** resolved
**Blocked by:** —

## Question

Should this effort's destination be redrawn as a **connector-driven** product — the user connects a Google Sheet or an Airtable base, and whenever a row is added or changed, the AI column logic runs and the column is written back?

## Answer

**No. Ruled out of scope for this effort.** It is not a redraw of this destination and not a resumption of this map — it is a **separate future effort with its own destination**, charted afresh if and when it is taken up.

It was grilled far enough to settle four things for that future effort:

- **It is a genuinely different product.** *"AI columns that stay in sync with a live sheet"* replaces *"the dataset is the source of truth"* with *"the sheet is the source of truth."* Most of this map's decisions survive — **What confidence means**, **One result shape across the three column types**, **Corrections layered over model output**, the Jev adapter, and the whole base. These do **not**: CSV upload and parsing, the spreadsheet/table UI, **Preview semantics** as written, the review screens, and CSV export.
- **Scheduled pull first; webhooks later.** Not push. This avoids a public HTTPS endpoint, expiring channel lifecycles (Google Drive channels and Airtable webhooks both expire), and Google's app-verification wall, while keeping the product's promise nearly intact — "whenever a row changes" becomes "every N minutes". Webhooks upgrade behind the same sync layer later, invisibly to everything downstream.
- **Google Sheets as the first connector**, on **market** grounds — Airtable already ships AI features, so it is a harder sell there. This knowingly pays the Google tax (no row-level change webhooks at all; OAuth scopes that are gated for production) in exchange for a better market and a more painful problem to solve. **Verify the OAuth-verification and webhook-lifecycle facts before charting** — they decide whether this is a solo-founder product at all.
- **A human editing our column in their sheet is a correction.** Detected as such, stored as one, and never overwritten. This makes **Corrections layered over model output** load-bearing rather than a nicety: the two-layer model is what stops the sync product overwriting people's work.

**Why it is out of scope:** `handoff.md` explicitly excludes Google Sheets and Airtable integrations from v1, and the reason it gives — low operational complexity for a solo founder, fast first value, low support burden — is unchanged by the idea being attractive. The cost is concrete: neither API offers transactions, detecting "this row changed" requires per-row fingerprinting, webhooks and channels expire, OAuth scopes are gated, the cost meter becomes continuous while billing is out of scope on this map, and row-level idempotency is required because **Jev documents no idempotency and `PersistedQueue` is at-least-once with enqueue-time dedup only**.

**What this effort owes it:** **The evaluation-service boundary** must keep the evaluator connector-agnostic — taking a row's content plus a column definition, never assuming the row came from our own stored dataset.
