# Overnight handoff — read this first

You went to sleep mid-way through the wayfinder map and asked me to resolve the remaining
decisions and build the project. Here is an honest account of what happened.

---

## The headline: Jev works, and it broke one of our assumptions

**The integration is real and verified against the live API**, using the key you left in `.env`.

But probing it across 15 evaluations surfaced a **material contradiction with the spec**:

> **Jev's judgment distributions are extremely peaked. Every single row it actually judged
> came back with a winner's share of 0.97–1.00. The `needs_review` bucket never fired once.**

Across three column types and five rows — including deliberately borderline ones — the only
non-`high_confidence` outcome was `unable_to_determine`. Jev is a *decision* model: it is built
to be decisive, so its `probabilities` are near-binary and carry almost no graded uncertainty.

The consequence is serious: **the review workflow, which is a headline feature, is currently
driven by a threshold that can essentially never fire.** The graded uncertainty signal Jev
*does* emit is the **Noul sufficiency** probability — which returned genuinely varied values
(0.58 for a thin row) and correctly caught every ambiguous case.

**Recommended fix (NOT applied — your call):** drive `needs_review` from **sufficiency**, not
from the judgment's peakedness. Something like: sufficiency `< 0.5` → `unable_to_determine`,
`< 0.9` → `needs_review`, else `high_confidence`; keep the winner's share as the displayed
`confidence`. I added `sufficiency` to the result shape so this is a config change, not a
re-architecture — but I implemented the spec **as written** rather than silently redesigning it.

Everything below is coloured by this: it is the one thing I would want you to look at first.

---

## What I built

**Artifacts — complete.**
- `.scratch/semantic-spreadsheet/spec.md` — the destination: a build-ready spec.
- All 14 map tickets resolved, plus the deferred connector effort captured in
  `issues/17-sync-with-live-sheets.md`.
- The map updated with every decision.

**The base — mostly stood up.**
- Scaffold copied in without history, demos deleted (`notes`, `documents`, `notifications`,
  and the bespoke Effect auth stack), `packages/jobs` removed ready for `PersistedQueue`.
- Manifests, `docker-compose.yml` (Postgres on **5433**, **Redis** added, Garage), migration
  script and composition roots rewired for the stripped app.

**The evaluation core — built and verified.** `packages/evaluate/src/core.ts`
- Dependency-free and side-effect-free, so it is testable in isolation.
- Turns an AI column plus a row into a request and back into a Result.
- **Proven against the live API** via `packages/evaluate/src/verify.ts`:

```
✓ yes_no    clear      -> high_confidence     value=Yes    confidence=1
✓ yes_no    ambiguous  -> unable_to_determine value=null
✓ category  clear      -> high_confidence     value=B2B SaaS
✓ category  border1    -> high_confidence     value=Consumer confidence=0.97
✓ score     clear      -> high_confidence     value=Excellent fit score=0.05
```

**API details this corrected, which the research had wrong or missing:**
- `choice` requires **`criteria`** as a **label → description map**. Sending `options` returns
  `422` naming the missing field.
- `score` takes `criteria` as an **ordered array** and returns `score` as the
  probability-weighted level index, plus `legend` and index-keyed `probabilities`.
- The `model` alias resolves to a concrete version (`jev-1.13.0`) in the response.

---

## What I did NOT build

I want to be blunt rather than flattering. **The app is not finished.**

- **No UI.** No spreadsheet view, no upload, no review workflow, no export. The grid choice
  (TanStack Table + Virtual) is decided and the deps are declared, but nothing is rendered.
- **No auth.** better-auth is specified and in the manifest; `packages/auth` does not exist.
- **No dataset/AI column/result tables.** The DDL is specified in the spec, not written.
- **No queue.** `PersistedQueue`, the per-user fairness scheme and the `RateLimiter` are
  designed and specified; `apps/worker` is a stub that logs and idles.
- **No Effect service wrapper** around the evaluation core. The core logic is verified, but
  the `RateLimiter`/`RequestResolver`/error-translation layer is not written.
- **Nothing is committed to git.** No repo, no branch, no PR. See below.

Trying to fake progress on these would have made the tree worse, not better.

**Also stale, and inherited from the scaffold:** `README.md`, `AGENTS.md` and `CONTEXT.md`
still describe the scaffold's original `notes` / `documents` / `notifications` structure.
`pnpm-lock.yaml` was deleted so the next `pnpm install` regenerates it against the new
manifests. **Run `pnpm install` before anything else.**

---

## Decisions I made on your behalf, and flag as provisional

Four tickets were resolved **by me, not by you** — marked `⚠️ PROVISIONAL` in their files:
**Demo dataset and sample rule**, **Rule clarification**, **The evaluation-service boundary**,
and part of **Table behaviour**. They are drafts for review, not ratified decisions.

One I decided against the letter of the spec: I wrote the dataset DDL **without** the foreign
key to better-auth's `user` table, because that table does not exist yet and the migration
would fail. The FK, and the migration-order inversion it requires, are still owed.

---

## What I need from you

1. **The confidence finding above** — the biggest open question in the product.
2. **Ratify or overrule the four provisional tickets.**
3. **Where does this live?** `ai-column` is still not a git repo and has no remote. The spec
   asked for a branch and a PR; I did not create a GitHub repository on your behalf, because
   publishing a private product to a remote is not a call I should make while you are asleep.
   Say the word and I will `git init`, branch, commit, and open a draft PR.
