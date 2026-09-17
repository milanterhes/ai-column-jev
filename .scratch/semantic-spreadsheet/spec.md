# Semantic Spreadsheet — Specification

**Status:** build-ready. Supersedes `handoff.md`, whose *product* content stands and whose *stack* section is superseded.
**Provenance:** synthesised from the wayfinder map at `.scratch/semantic-spreadsheet/map.md` and the fourteen decisions recorded in `.scratch/semantic-spreadsheet/issues/`.
**Ratification:** every decision in `issues/11`–`issues/14` is marked provisional — agent-decided under explicit delegation. Decisions in `issues/01`–`issues/10` were made with the human present.

---

## 1. What this is

A self-serve web app where a user uploads a CSV, adds **AI columns** that require human-like judgment, inspects the results with their confidence, reviews the uncertain rows, and exports the enriched CSV.

The central user thought is *"I wish this spreadsheet had one more column, but a human would have to fill it in."* The product turns that into a **+ AI column** button. The spreadsheet is the interface; it is not a chatbot and not a workflow builder.

Per-row semantic evaluation is done by **Jev** (TypeSafe AI's System One model), which returns typed probabilistic decisions. A general-purpose LLM is used **only** to help the user phrase a rule before any evaluation happens. It never evaluates a row.

---

## 2. Scope

**In:** auth · CSV upload and parse · dataset storage · the spreadsheet view · Yes/No, Category and Score AI columns · the Jev evaluation service · 10-row preview · async full run · confidence display · uncertain-row review · CSV export · a built-in demo dataset · rule clarification · usage counting.

**Out:** XLSX · saved rules and a template gallery · Stripe, plans, quotas and limits · SSO, RBAC, teams · Google Sheets and Airtable integrations · a public API · collaborative editing · chat interfaces · workflow builders · LLM "Explain result" · microservices · a visual polish pass.

---

## 3. The base

Copied from `~/code/scaffold` **without git history**, demos stripped. A pnpm + Turbo monorepo (`apps/*`, `packages/*`).

| Concern | Choice | Note |
| --- | --- | --- |
| Web | TanStack Start + TanStack Router, Vite, React 19 | not Next.js |
| Styling | Tailwind v4, CSS-first | theme tokens in `apps/web/src/styles/app.css` |
| UI kit | shadcn on **Base UI** (not Radix) | only `button`, `table`, `pagination`, `native-select` ship |
| Grid | **TanStack Table + TanStack Virtual** | headless; named by **Table behaviour in the slice** |
| Server | Effect 4 (`4.0.0-rc.112`), APIs under `effect/unstable/*` | |
| Database | Postgres via `@effect/sql-pg` | **no ORM**; raw SQL, rows decoded through Effect `Schema` and **never cast** |
| Queue | **Effect `PersistedQueue`** (`effect/unstable/persistence`) | at-least-once, no backoff, no scheduling, no dead-letter |
| Rate limiting | **Effect `RateLimiter`**, adaptive | requires Redis |
| Auth | **better-auth 1.7.4** | following `~/code/platform` |
| Storage | S3-compatible via presigned URLs | Garage locally |
| Testing | Vitest 4 with `@effect/vitest` | API suites compose the real router |

**Deliberately left to the builder:** the exact ORM-free repository layout, the hosting target, component generation, and the queue's poller strategy.

**Infrastructure required:** Postgres, **Redis** (for `RateLimiter` state), S3-compatible object storage.

**Migrations:** every package owns its migrations inline; `scripts/migrate.ts` applies them. **Auth migrations must run first**, so that foreign keys to better-auth's `user` table resolve. This inverts the order in `~/code/platform`.

---

## 4. Domain model

Canonical vocabulary. *Evaluation* is a **unit of account, not an entity** — there is no evaluation table.

- **AI column** — a column the user defines, whose values are judgments. *(Not "semantic column".)*
- **Result** — one row evaluated against one AI column.
- **Correction** — a human's override of a Result.
- **Effective value** — the correction if one exists, otherwise the model's selected value.
- **Status** — one of `high_confidence`, `needs_review`, `unable_to_determine`, `failed`.

### Tables

```sql
-- ownership: every table below hangs off user_id, FK → better-auth's "user"(id)
dataset (id, user_id, name, filename, row_count, column_count,
         columns jsonb,          -- original headers, in order
         storage_key text,       -- <userId>/<datasetId>/original.csv
         created_at)

dataset_row (id, dataset_id, row_index int, data jsonb)

ai_column (id, dataset_id, name, type,             -- 'yes_no' | 'category' | 'score'
           instruction text,
           labels jsonb,          -- [{name, description}], in order
           ordered boolean,       -- true for score
           needs_review_threshold numeric default 0.8,
           created_at)

result (id, ai_column_id, row_id,
        selected_value text,          -- a label name, or null when there is no answer
        confidence numeric,           -- the winner's share, computed by us
        provider_confidence numeric,  -- Jev's own, kept for later comparison
        status text,
        detail jsonb,                 -- score: {fractionalScore}
        provider_response jsonb,      -- trimmed: {answers, usage}
        created_at)
  -- UNIQUE (ai_column_id, row_id): re-runs upsert

correction (id, ai_column_id, row_id,       -- anchored to the PAIR, never to a result
            value text, corrected_by text, created_at)
  -- UNIQUE (ai_column_id, row_id)

batch_run (id, ai_column_id, status,        -- 'running'|'completed'|'cancelled'|'failed'
           total_rows int, cancelled boolean,
           input_tokens bigint, started_at, completed_at)

usage_counter (user_id, evaluations bigint) -- survives dataset deletion; holds no content
```

**Why a correction is anchored to the *(AI column, row)* pair:** every re-run rewrites results. Anchored to a result, human work would be destroyed by the workflow that generates it. Anchored to the pair, it outlives any number of re-runs.

**The four states, and what each asks of the user:**

| Status | Meaning | User action |
| --- | --- | --- |
| `high_confidence` | Answered, at or above threshold | none |
| `needs_review` | Answered, below threshold | judge the model's answer |
| `unable_to_determine` | The input was insufficient | fix the row's data |
| `failed` | The evaluation errored | retry |

---

## 5. Evaluation

### 5.1 The Jev adapter

One service, `evaluate({ rows, aiColumn })`, taking **row content** — never a stored row id. That is what keeps it reusable by a future connector-driven product.

**Verified request shape** (`POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer $JEV_KEY`, model `jev-latest`):

```jsonc
{
  "state": "<the whole row, rendered>",
  "model": "jev-latest",
  "questions": {
    "judgment": {
      "type": "choice",                       // yes_no and category
      "instructions": "<the column's instruction>",
      "criteria": { "<label>": "<description>", ... }
    },
    "sufficiency": {
      "type": "noul",
      "instructions": "Is there enough information here to <instruction>?"
    }
  }
}
```

For a **Score** column the judgment instead uses `"type": "score"` with `"criteria": ["<level>", ...]` — an **ordered array**.

**Verified response:**

```jsonc
{ "model": "jev-1.13.0",
  "answers": {
    "judgment":    { "type": "choice", "choice": "Yes", "confidence": 0.98,
                     "probabilities": { "No": 0.01, "Yes": 0.99 } },
    "sufficiency": { "type": "noul", "noul": 0.58 }
  },
  "usage": { "input_tokens": 365, "output_tokens": 55 } }
```

Score answers return `score` (the probability-weighted level index), `legend` (index → level text), `probabilities` keyed by index string, and `confidence`.

**Two questions, always, in one call** — the judgment plus the Noul sufficiency check. Jev evaluates questions in parallel and adding one barely changes latency.

**Batching lives in the adapter**, via an Effect `RequestResolver`. The queue stays one-item-per-row.

**A `RateLimiter` wraps every call** with adaptive feedback: the response status and `Retry-After` are reported back so the limiter *learns* Jev's undocumented limit.

**Error translation.** `422` and `401` are **terminal** — the caller writes a failed Result and succeeds, burning no retry. `429`, `529`, `5xx`, timeouts and connection failures are **retryable**. Provider errors are **translated before logging**; raw bodies, which may echo row content, never reach logs.

**Stored per result:** a trimmed projection — the `answers` subtree plus `usage`. Never the full envelope.

### 5.2 Confidence

**Confidence is the winner's share of the returned distribution** — the probability mass Jev placed on the answer it selected — computed by us, not read from Jev's `confidence`, which is also stored for comparison.

- **Yes/No is a two-option `choice`**, not `noul`. This erases the fact that `noul` returns no confidence field, and gives all three column types one distribution shape.
- **The threshold is per-column, default `0.8`, editable from the start.**
- **"Unable to determine" is an input state, detected by the sufficiency question.** When it reports insufficient information, the judgment is **discarded** — the cell reads "Unable to determine" and the judgment survives only in the raw response.
- **The spec may not claim calibration.** Confidence is a relative, thresholded signal: *"higher is more reliable; below the threshold it asks for review."* Never "0.9 means 90% likely correct" — Jev asserts calibration but publishes no reliability curve.
- The real number is **always preserved internally**, even when a cell renders a bucket.

### 5.3 Score

A Score column's stored value is the **argmax level label** ("Good fit"), never the fractional number. Jev's fractional `score` is retained as the Result's `detail` and shown in the row-detail panel. The cell shows the label.

---

## 6. Screens

### 6.1 Landing
Hero: *"Add columns to your spreadsheet that require human judgment."* An example table showing a judgment column with confidences. Primary CTA **Upload CSV**; secondary **Try it with sample data** (creates the demo dataset). Copy emphasises: no workflow builder, no coding, structured answers, confidence-aware results, export when done. **No "Book a demo."**

### 6.2 Upload
Drag/drop CSV. On parse: filename, row count, column count, first ~20 rows, then a prominent **+ AI column**. Limits: **50 MB, 100,000 rows, 256 columns**; exceeding one names the limit *and* the actual value. Decoding: UTF-8; on failure, transcode from **Windows-1252** and **tell the user what was assumed**; reject only what cannot be decoded.

### 6.3 Add AI column (drawer)
Column name · the question (*"What should this column determine?"*) · output type (Yes/No · Category · Score). Category allows adding/editing label names; Score allows adding **ordered** levels. Each label carries an optional description, which becomes Jev's `criteria`. Contextual example questions are suggested from the dataset's own headers. An **"Improve this"** affordance offers a rewritten instruction which the user must explicitly accept; the original stays recoverable; an unaccepted suggestion is never used. Buttons: **Preview on 10 rows** · Cancel.

### 6.4 Preview
Evaluates **ten rows spread evenly through the sheet**, count adjustable **5–50**. Results render inline with confidence; low-confidence rows carry ⚠. Preview writes **real Results**; the AI column is created at first preview. Closing the drawer without running **deletes the column and its results** — no half-evaluated column is ever left behind. Re-previewing **recomputes every previewed row**; there is no caching. Preview runs **through the same queue as a full run**, bounded.

### 6.5 Full run
Promotion **reuses** the previewed rows and evaluates only the remainder. The browser is not required to stay open. Progress is **derived from the results table** and polled every couple of seconds. There is a **Cancel** control. On completion: the per-answer distribution, then **the four status counts separately**. A dollar estimate appears **only after a preview has measured real token usage**; the headline number is **evaluations** (`rows × columns`).

### 6.6 Spreadsheet view
TanStack Table + TanStack Virtual; continuous scrolling, no pagination. Horizontal scrolling, sorting, filtering, filter by result, filter by confidence, hide/show columns. **Score columns sort by level order, not alphabetically.** Filtering by confidence means **the four status buckets**, never a numeric slider. Filters combine **AND across columns, OR within one**, and **live in the URL**. A semantic cell shows the value, a small confidence percentage, and ⚠ for needs-review — never probability vectors. AI columns get a tinted header and are separated from originals by a single vertical rule. No icons, no sparkles.

### 6.7 Row detail
Clicking a semantic cell opens a panel: the input values relevant to the judgment, the selected answer, the confidence, the distribution, and — where a correction exists — the model's original value. **No LLM "Explain result" button.**

### 6.8 Review uncertain rows
A dedicated workflow over rows whose status is `needs_review` **and which have no correction** — so the queue shrinks as the user works, while the run summary's counts never change. Presented one row at a time, keyboard-first: **Y / N / S** for yes / no / skip. Corrections are **constrained to the column's label set**, and rows marked `unable_to_determine` or `failed` **are** correctable. A corrected cell renders normally with a **small persistent edited marker** — never hover-only.

### 6.9 Export
RFC 4180 CSV, UTF-8, one header row. Original columns **verbatim and in original order**, then per AI column in creation order its **value** and its **confidence**, with confidence **on by default** behind one toggle. Column naming: the AI column's name verbatim; its companion `<name> Confidence`; collisions get a numeric suffix. Non-answered rows write **`Unable to determine`** / **`Failed`** into the value cell with a blank confidence. Confidence is a **plain decimal** (`0.72`). The export carries the **effective value only**. **All rows, original row order, regardless of filters.** No provenance columns, no row-index column.

---

## 7. Background work

**One queue item per *(row, AI column)*.** Per-row granularity gives exact progress, minimal retry, and a duplicate cost that rounds to nothing — Jev charges **$0.042 per million input tokens** and nothing for output.

**Fairness.** `PersistedQueue` is **strict FIFO within a `queue_name`** with no priority, so a shared queue would let one user's 1,000-row run block another's ten-row preview. Therefore: **one queue name per active user**, a **round-robin claim loop** so no user monopolises a pass, and a small number of concurrency slots **reserved for interactive work** so preview latency is guaranteed rather than likely.

> **Accepted risk, recorded deliberately:** decided by reasoning, not measurement. The open question was what many queue instances cost, since each runs its own 1s poll fiber. If fairness or overhead misbehaves, this is the first decision to revisit.

**Retries.** Retryable failures back off (honouring `Retry-After`) and then fail, so the queue's next attempt is naturally delayed. Terminal failures write a failed Result and **succeed**, burning no attempt. On exhaustion the row stays failed; the user-facing **"Retry failed rows"** re-offers new items with fresh ids. No scheduling infrastructure is built.

**Cancellation** is a `cancelled` flag on the run, checked as the handler's first act. In-flight rows finish; remaining items no-op through the queue.

**Completion.** `completed` means every row reached a terminal state, including failed ones. A run with 8,241 good rows and one timeout is **completed**, not failed. `failed` is reserved for the run being unable to proceed at all.

**Usage.** `rows × columns` is an evaluation. Counted, never billed. The counter survives dataset deletion and holds no content.

---

## 8. Privacy and lifecycle

- **Isolation:** an ownership column with a **foreign key to better-auth's `user.id`** on every table we own, plus every query scoped by the session user. Isolation never keys off email or vendor metadata.
- **Storage:** keys are `<userId>/<datasetId>/original.csv`. The seam must gain a **server-side object read** — the inherited one exposes only presign/HEAD/delete, so parsing has no way to reach the bytes.
- **What leaves the machine:** the **whole row** is sent to Jev as its `state`, and the product says so plainly.
- **Logging:** identifiers and metrics only — never cell values, never instruction text. Row content must not reach logs or error trackers even on failure.
- **Deletion:** hard, immediate, and complete — dataset, rows, AI columns, results, corrections and batch runs, with the archived object deletion **enqueued and retried**. The only survivor is the aggregate usage count, which holds no content. No grace period, no archive, no shadow copy.

---

## 9. Failure modes

Malformed CSV → a specific, actionable parse error naming the row. Non-UTF-8 → transcoded, with the assumption stated. Oversized input → the limit and the actual value. Jev `422` → a terminal failed row. Jev `429`/`529` → backed off and retried. Partial batch failure → reported in the summary and retryable, never fatal. Browser closed → irrelevant; the run lives in the queue. Duplicate delivery → harmless, because one row costs a fraction of a cent and results upsert on *(AI column, row)*.

---

## 10. Acceptance criteria

A brand-new user can: create an account · upload a CSV · see its data · add a Yes/No AI column · enter "Is this company B2B SaaS?" · preview the result on rows · see confidence values · approve the rule · process the entire CSV · filter rows by answer and confidence · review uncertain rows · export the enriched CSV — **without reading documentation**.

---

## 11. Known limitations and deferred work

- XLSX is not supported; CSV only.
- The fairness design is reasoned, not measured.
- Whether the `PersistedQueue` store moves from Postgres to Redis is unresolved.
- A connector-driven, event-driven product (sync against live Google Sheets or Airtable) was considered and **deliberately deferred** — see `.scratch/semantic-spreadsheet/issues/17-sync-with-live-sheets.md`. This spec owes it one thing, which the adapter satisfies: **stay connector-agnostic.**
- The evaluation adapter is hand-written over HTTP rather than using TypeSafe's published SDK.
- Every decision in `issues/11`–`issues/14` is **provisional** and needs human ratification.
