# Overnight handoff — read this first

You went to sleep mid-way through the wayfinder map and asked me to resolve the remaining
decisions and build the project. Here is an honest account of where things stand.

**Short version: the product works end to end.** I verified the whole loop against the live
Jev API and a real Postgres. One design assumption did not survive contact with the provider,
and it is the first thing below.

---

## The headline: Jev's confidence behaves differently per column type

**The integration is real and verified.** But running a 35-row sample across all three column
types (see below) produced a finding that **corrects an earlier, too-broad version of this
note**. The first pass only tested a Yes/No column and concluded the review workflow could
never trigger. That was wrong — it is specific to one column type.

**Across 35 support tickets:**

| Column type | High confidence | Needs review | Unable to determine |
| --- | --- | --- | --- |
| Yes/No — "Feature request?" | 23 | **1** | 11 |
| Category — "Issue type" | 22 | **5** | 8 |
| Score — "Urgency" | 10 | **16** | 9 |

**`needs_review` works fine for Category and Score.** Those columns produce genuine
distributions — confidences ranging 0.5–1.0, with a real ⚠ tail. The problem is **binary
Yes/No specifically**: a two-option Choice collapses to a near-certain distribution (every
judged row came back 0.96–1.00), so a threshold on confidence can never fire there. That is a
property of asking a yes/no question, not a flaw in the confidence model.

**A second, separate bug this exposed: the sufficiency gate was miscalibrated.** It sat at
`0.5`, and Jev is systematically *under*-confident on the sufficiency question — it put rich,
plainly judgeable messages in the 0.4–0.8 band. An invoice bug scoring `0.49` was being thrown
away as unusable. The clean separation in the data is between genuinely unusable rows
(`"help"` 0.08, `" "` 0.06, `"The sync is broken."` 0.20) and ordinary content (0.37 and up).
**I moved it to `0.3`**, which sits in the empty gap, and documented the evidence in
`packages/evaluate/src/core.ts`.

### Still open, and the real remaining question

**The sufficiency question's wording is subtly wrong.** It asks *"is there enough information
here to answer X?"* — which fails on rows where the **absence** of information *is* the answer.
A clear bug report contains nothing about feature requests, so it scores low sufficiency for
"Is this a feature request?" and gets discarded, when the correct answer is plainly "No". That
is why the Yes/No column still has 11 `unable_to_determine`. The question should be framed
around whether the row contains what the judgment *needs*, not whether the judgment feels
answerable. Worth fixing before trusting `unable_to_determine` counts.

**Recommended next step:** offer both signals per column type. For Category and Score, the
confidence threshold works and should carry on. For Yes/No, either fall back to sufficiency or
drop `needs_review` for binary columns entirely, since the model is effectively deterministic
there. I implemented the spec **as written** apart from the threshold move, rather than
redesigning it quietly.

## What is built and verified

Every claim below was run against the live API and a real Postgres, not reasoned about.

| Flow | Status |
| --- | --- |
| Auth — better-auth email OTP | ✅ verified (code → session cookie) |
| Dataset ingest — CSV + demo dataset | ✅ verified (20 rows) |
| AI column creation | ✅ verified |
| Preview on a spread of rows | ✅ verified (real Jev calls) |
| Full run | ✅ verified (20/20 rows evaluated) |
| Confidence + the four statuses | ✅ verified |
| Corrections (create + revert) | ✅ verified (persistent "edited" marker) |
| Review workflow, keyboard-driven | ✅ verified (Y advanced the queue) |
| CSV export | ✅ verified (correction reflected) |
| `pnpm lint` (whole workspace) | ✅ 10/10 tasks clean |
| `pnpm build` | ✅ 6/6 tasks |
| **Browser click-through** | ✅ **whole demo driven by hand, zero console errors** |

Actual export from the run:

```
company,description,employee_count,country,B2B SaaS?,B2B SaaS? Confidence
Acme,"Acme builds HR software for enterprise companies, sold as a subscription.",420,United States,Yes,1.00
```

### The packages

- **`packages/evaluate`** — the Jev adapter. A pure, dependency-free core plus an Effect
  service. This is where the wire contract was pinned down: **`choice` requires `criteria` as
  a label → description map** (sending `options` returns a 422 naming the field), and
  **`score` takes an ordered array** and returns the probability-weighted level index.
- **`packages/spreadsheet`** — CSV ingest with encoding detection, the domain schema and
  migrations, repositories, and the application services.
- **`packages/auth`** — better-auth (email OTP + organization), bridged into Effect following
  `~/code/platform`.
- **`apps/web`** — the HTTP surface plus the UI: landing, sign-in, a virtualised spreadsheet
  grid, the add-column drawer, row detail, the review workflow, and export.
- **`apps/worker`** — a stub. See limitations.

---

## The sample CSV — `apps/web/public/customer-feedback.csv`

Downloadable from the landing page and the empty datasets screen, and it is the same data
"Try it with sample data" loads. **35 support tickets**, columns
`ticket_id, account, plan, mrr_usd, submitted_at, subject, message`.

It is engineered rather than grabbed, because only *some* rows are interesting to a model like
Jev:

- **Rich, specific messages** for most rows, so the judgments have something to bite on.
- **Rows with no useful content** — `"help"`, `"?"`, an empty message, `"Everything broke this
  morning."` — which is what drives `unable_to_determine` and fills the review queue.
- **Genuinely ambiguous rows** — a ticket that could be a bug *or* a feature request, a
  cancellation that is also a churn signal, praise that is also a feature hint. These are what
  produce `needs_review`.
- **A `plan` / `mrr_usd` spread**, so "does this indicate churn risk?" has something to weigh.
- **One ticket reporting a possible cross-workspace data leak**, so an urgency score has a real
  top of the range.

It ships with **one column of each type** — Yes/No, Category, and Score — because a Yes/No
column alone is the *worst* showcase for the confidence model, and that is exactly what the
original built-in demo had.

## What is *not* done

I would rather be blunt than flattering.

- **The queue is not wired.** `run` evaluates inline in the request. The design — one
  `PersistedQueue` item per (row, AI column), per-user fair scheduling, cancellation via a run
  flag — is specified in `spec.md` §7 and `issues/08-batch-run-semantics.md`, but
  `apps/worker` does nothing yet. A large dataset will make the request slow, and there is no
  cancel control.
- **Redis is provisioned but unused.** The adaptive `RateLimiter` is not wired in; the
  evaluation service does its own exponential backoff. Redis is running and waiting for it.
- **No foreign key to better-auth's `user` table.** The ownership column exists and every
  query is scoped by it, but the FK is absent because it must be added *after* auth
  migrations. The migration order is already correct for it.
- **The UI is built, typechecks, builds, and I drove the whole demo by hand in a browser.**
  Landing → sign in → sample data → run → row detail → correction → review → export, with zero
  console errors or warnings.
- **XLSX, saved rules, templates, billing, and the LLM "Explain result"** are out of scope by
  decision, not by omission.
- **No remote, so no PR.** The work is on the branch `feat/semantic-spreadsheet` with one
  commit. I did not create a GitHub repository on your behalf — publishing a private product
  to a remote is not a call to make while you are asleep. Say the word and I will.

---

## Things I decided on your behalf, marked provisional

Four tickets were resolved **by me, not by you** — flagged `⚠️ PROVISIONAL` in their files:
**Demo dataset and sample rule**, **Rule clarification**, **The evaluation-service boundary**,
and **Table behaviour**. They are drafts for review, not ratified decisions.

I also made two calls worth naming:
- The HTTP surface is a small hand-rolled router over the Effect services rather than
  `HttpApi` groups, because raw-byte uploads fight the schema-driven codec layer. The services
  are pure Effect and know nothing about HTTP, so swapping the transport later is contained.
- Upload sends raw bytes with `?filename=`, not multipart.

---

## Running it

**One command:**

```bash
pnpm demo
```

That starts Postgres and Redis, waits for them, applies migrations, and boots the app. It is
safe to re-run. If `.env` is missing it will create one from `.env.example` and tell you to add
your key.

Then open <http://localhost:3000>, sign in with any email (the six-digit code is printed in the
terminal), and click **Try it with sample data**. The column ships unevaluated, so press
**Run all** in the AI column bar to watch it work.

<details>
<summary>Or step by step</summary>

```bash
pnpm install
docker compose up -d postgres redis
pnpm migrate
pnpm dev
```

</details>

`.env` already has your `JEV_KEY` and a generated `BETTER_AUTH_SECRET`. It is gitignored.
