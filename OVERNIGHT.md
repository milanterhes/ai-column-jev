# Overnight handoff — read this first

You went to sleep mid-way through the wayfinder map and asked me to resolve the remaining
decisions and build the project. Here is an honest account of where things stand.

**Short version: the product works end to end.** I verified the whole loop against the live
Jev API and a real Postgres. One design assumption did not survive contact with the provider,
and it is the first thing below.

---

## The headline: Jev broke one of our assumptions

**The integration is real and verified.** But probing it — and then confirming it across a
full 20-row run — surfaced a material contradiction with the spec:

> **Jev's judgment distributions are extremely peaked. Of 20 rows evaluated, 17 came back at
> confidence 0.97–1.00 and 3 were `unable_to_determine`. `needs_review` fired zero times.**

The probability distribution across all 20 rows was `{1.00: 15, 0.99: 1, 0.97: 1}`. Nothing
ever landed below the `0.8` threshold.

Jev is a *decision* model — it is built to be decisive — so its `probabilities` carry almost
no graded uncertainty. The consequence is serious: **the review workflow, a headline feature,
is driven by a threshold that cannot fire.** The graded signal Jev *does* emit is the **Noul
sufficiency** probability, which ranged 0.05–0.97 and correctly caught every unusable row.

**Recommended fix (NOT applied — your call):** drive `needs_review` from **sufficiency**, not
from judgment peakedness — e.g. sufficiency `< 0.5` → `unable_to_determine`, `< 0.9` →
`needs_review`, else `high_confidence`, keeping the winner's share as the displayed
`confidence`. `sufficiency` is already stored on every result, so this is a threshold change,
not a re-architecture. I implemented the spec **as written** rather than silently redesigning
it. It is the single thing I would want you to look at first.

---

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
| Corrections (create + revert) | ✅ verified |
| CSV export | ✅ verified (original columns verbatim, then value + confidence) |
| `pnpm lint` (whole workspace) | ✅ 10/10 tasks clean |
| `pnpm build` | ✅ 6/6 tasks |

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
- **The UI is built and typechecks and the production build succeeds, but I did not click
  through it in a browser.** I verified the API it calls, not the pixels.
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

```bash
pnpm install
docker compose up -d postgres redis garage
pnpm migrate
pnpm dev          # http://localhost:3000
```

Sign in with any email; the six-digit code is printed to the server terminal. Then
**Try it with sample data** on the landing page.

`.env` already has your `JEV_KEY` and a generated `BETTER_AUTH_SECRET`. It is gitignored.
