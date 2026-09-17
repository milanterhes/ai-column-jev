# The evaluation-service boundary

**Type:** grilling
**Status:** resolved
**Assignee:** milanterhes
**Blocked by:** 01
**Ratification:** ⚠️ **PROVISIONAL — agent-decided under explicit delegation while the human was asleep. Not ratified by a human. Review on waking.** The API shapes below are *not* inferred: they were verified against the live endpoint.
**Context:** `research/jev-api.md`; inherits from **What confidence means** — every evaluation sends **two** questions (a Noul sufficiency check and the judgment) and they must travel together; from **One result shape across the three column types** — the primitive mapping is Yes/No and Category → Choice, Score → Score, with the label set becoming Jev's `option → description` map; from **Batch-run semantics** — the interface takes a row's **content** not a stored row id, exposes one entry point for preview and full run, provides the batching `RequestResolver`, and owns the `RateLimiter` wrapping and the retryable/terminal error translation; and from **Dataset privacy and lifecycle** — Jev's `state` is the **whole row**, and provider errors are translated before they are logged

## Question

Decide the seam between the app and Jev — the brief demands an adapter/service layer so Jev could theoretically be swapped later, designed around the *actual* Jev API rather than an invented abstraction.

Settle, with the real API in hand:

- **The interface.** The brief sketches `evaluateRows({ rows, columnDefinition })`. What the real interface is: inputs, outputs, batching, and whether it is one call per preview and one per batch chunk.
- **The row-to-request mapping — the highest-stakes decision here.** Jev has one endpoint taking **one `state` plus many questions**, and no dataset-upload primitive. So either each row is its own request (simple, one call per row, 8,242 calls), or many rows are folded into one `state` and judged with one shared question (the official cookbooks score 218 items in one request, which is orders of magnitude cheaper and faster). Choose, and settle the consequences: how a batched answer is mapped back to its row, how partial failure inside a batch works, how the ~32k-token request budget is chunked, and what happens when a row's text is too large to batch.
- **What crosses the seam.** Where deterministic preprocessing happens (which columns go to Jev, how a row is rendered into the text Jev judges), and whether that is inside or outside the adapter.
- **What comes back.** The normalised result the app stores, and how much of Jev's raw response is kept for debugging.
- **Failures.** How provider errors are translated into the app's own error vocabulary, so the batch runner never learns Jev's error shapes.
- **The mock.** Whether a development mock is still required now that real credentials exist, and what it must faithfully reproduce.
- **Where the seam lives**, expressed as a responsibility rather than a folder.
- **Connector-agnostic, by requirement.** A connector-driven product — sync AI columns against a live Google Sheet or Airtable base, evaluating rows as they change — was considered and deliberately deferred (see **Sync AI columns with live Google Sheets and Airtable** on the map's Out-of-scope list). This effort owes it one thing: **the seam must take a row's *content* plus a column definition, and must not assume the row came from our own stored dataset.** If the evaluator can only be handed a `DatasetRow` id, a future sync effort redoes the core instead of reusing it. That costs nothing now and is expensive to retrofit.
- **Its effect context.** The seam is Effect code on `@effect/sql-pg`, and it will be called from a `PersistedQueue` handler. Decide what the service requires and provides, what its typed error channel is, and how it stays callable both from a preview request and from a queue worker. Note the queue stores its payload as schema-encoded `TEXT` with **at-least-once** delivery and **no idempotency**, so the seam must be safe to call twice for the same row and the result must be written in a way that a repeat is harmless.

This is the one architectural decision the spec pins, because the brief names it.

## Answer

> ⚠️ **PROVISIONAL — decided by the agent, not the human** (asleep, explicitly delegated). The **API shapes are verified, not inferred** — every request/response below was executed against `https://api.typesafe.ai/v1/systemone` with the project's own key and returned HTTP 200.

### Verified request and response

```jsonc
// request
{
  "state": "<the whole row, rendered>",
  "model": "jev-latest",
  "questions": {
    "<judgment id>": {
      "type": "choice",
      "instructions": "Is this company primarily a B2B SaaS company?",
      "criteria": { "Yes": "Primarily sells SaaS to businesses.", "No": "Does not." }
    },
    "<sufficiency id>": {
      "type": "noul",
      "instructions": "Is there enough information here to judge whether this is a B2B SaaS company?"
    }
  }
}

// response (verified)
{
  "model": "jev-1.13.0",
  "answers": {
    "is_b2b_saas": { "type": "choice", "choice": "Yes", "confidence": 0.98,
                     "probabilities": { "No": 0.01, "Yes": 0.99 } },
    "enough_info": { "type": "noul", "noul": 0.58 }
  },
  "usage": { "input_tokens": 365, "output_tokens": 55 }
}
```

**Discovered by probing, and load-bearing:** `choice` requires **`criteria`** — a **map of label → description**, not an array of options. A first attempt passing `options` returned `422` naming `questions.<id>.choice.criteria` as the missing field. **`score` takes `criteria` as an ordered array** of level descriptions and returns `score` (the probability-weighted level index — verified: `0×0.9 + 1×0.07 + 2×0.02 + 3×0.01 = 0.14`), `legend` (index → level text), `probabilities` keyed by index string, and `confidence`. `noul` returns a bare `noul` probability and **no confidence field**. The `model` alias resolves to a concrete version (`jev-1.13.0`) in the response.

### The interface

**`evaluate({ rows, aiColumnDefinition })`, taking each row's *content* — never a row id.** This is the requirement **Sync AI columns with live Google Sheets and Airtable** depends on: a future sync effort hands it rows from a sheet, and a seam that only accepts a stored `DatasetRow` id would force that effort to redo the core.

**Two questions per evaluation, always, in one call.** The judgment — `choice` for Yes/No and Category, `score` for Score — plus a **Noul sufficiency question**. They travel together: **What confidence means** established that a false sufficiency answer marks the row `unable_to_determine` and **the judgment is discarded**, retained only in the raw response. One call carries both because Jev evaluates questions in parallel and adding questions barely changes latency.

**Label set → `criteria`.** A Yes/No column's two labels and a Category column's N labels become the `choice` `criteria` map. A Score column's ordered labels become the `score` `criteria` array. This is why **One result shape across the three column types** could settle on a single label-set shape.

**Batching lives here, not in the queue: an Effect `RequestResolver`** coalesces concurrent row evaluations into batched requests, as **Batch-run semantics** requires. The queue stays dumb (one item per row); the adapter gets clever.

**The `RateLimiter` wraps every call, with adaptive feedback.** The adapter reports the response status and `Retry-After` back through `adaptiveFeedback`, so the limiter *learns* Jev's undocumented limit rather than us guessing it.

**Error translation — the adapter speaks the app's vocabulary, never Jev's.** `422` and `401` become **terminal** (the caller writes a failed Result and succeeds, burning no retry attempt). `429`, `529`, `5xx`, connection failures and timeouts become **retryable**. **Provider errors are translated before they are logged** — raw provider bodies, which may echo row content, never reach application logs.

**What is stored:** a **trimmed projection** — the `answers` subtree plus `usage` — on every row, and never the full envelopes. Per **One result shape across the three column types**.

**No development mock.** The brief said to build one only if credentials were missing. They are present and the integration is verified against the live API, so a mock would be dead code that drifts. **`JEV_KEY` is the env var** (the SDK's own `TYPESAFE_API_KEY` is not used, since the adapter is hand-written over HTTP).

**Score's fractional value is retained** as the Result's detail, per **One result shape across the three column types**. Jev's own `confidence` is stored alongside our computed winner's-share, per **What confidence means**.
