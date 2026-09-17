# The real Jev / TypeSafe evaluation API

**Ticket:** `issues/01-research-jev-api.md`
**Researched:** 2026-09-17
**Method:** primary sources only — vendor site (`typesafe.ai`), official docs (`docs.typesafe.ai`), official API reference, official SDK docs/source references. Secondary coverage (blog reviews, aggregator sites) was used only to find primary URLs and is explicitly excluded from the findings below.

---

## Headline finding

**"Jev" and "TypeSafe" are real and callable.** Jev is the first public **System One Model** from **TypeSafe AI**, announced **15 Sep 2026** and currently in **early access / waitlist**. It is a hosted, decision-only semantic model: you send one `state` plus typed `questions`, and it returns typed probabilistic decisions. It is **not** a dataset-upload bulk-evaluation service and has **no per-row batch endpoint** — batching is done by putting many items into one `state`/question and asking many questions per request.

- Vendor: TypeSafe AI (San Francisco). Founder/CEO Diogo Almeida.
- Endpoint: `POST https://api.typesafe.ai/v1/systemone`
- Model alias: `jev-latest`
- Console / API keys: `console.typesafe.ai`
- Pricing: **$0.042 / M input tokens ($42 / billion); output tokens free** (vendor-published).

There is **no separate product called "TypeSafe" distinct from Jev** — TypeSafe is the company; Jev is the model. The brief's "Jev / TypeSafe" is one product.

What follows is labelled **[VERIFIED]** (read directly on a primary source), **[INFERRED]** (reasoned from primary sources, not stated), or **[UNDETERMINED]** (not found on any primary source).

---

## 1. Identity and availability

| Fact | Value | Status |
| --- | --- | --- |
| Product | Jev — a "System One Model" for fast typed decisions | [VERIFIED] |
| Vendor | TypeSafe AI (`typesafe.ai`), SF; Founder/CEO Diogo Almeida | [VERIFIED] |
| Launch | 15 Sep 2026, blog "Introducing System One Models & Jev" | [VERIFIED] |
| Availability | **Early access / waitlist**, not GA | [VERIFIED] |
| Self-hosted / weights | None; hosted API only | [VERIFIED] |
| Naming | "Jev" after William Stanley Jevons; "System One" after Kahneman | [VERIFIED] |
| Trials | Each new model gets a `-latest` alias (e.g. `jev-latest`); an account model-list resource exists in the SDKs | [VERIFIED] |

**How access/credentials are obtained [VERIFIED]:** log into the console (`console.typesafe.ai`, playground at `/playground`), create an API key at `console.typesafe.ai/settings/keys`. The docs describe "opening early access and bringing developers off the waitlist." There is no documented self-serve signup, and no free-tier amount is published.

---

## 2. Interface and auth

### HTTP [VERIFIED]
```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

**Request body:**
```json
{
  "state": "string | object | array",
  "model": "jev-latest",
  "questions": {
    "<question id>": { "type": "choice|score|noul", "instructions": "...", "criteria": ... }
  }
}
```
- `state` is the content to evaluate; a string, or structured data (object/array) such as chat logs, records, or app state. [VERIFIED]
- `questions` is a map keyed by an **id you choose**; the id is returned unchanged and **is not sent to the model**. [VERIFIED]
- `instructions` and `criteria` may themselves be structured JSON. [VERIFIED]

**Response body:**
```json
{
  "model": "jev-latest",
  "answers": {
    "<question id>": { "type": "...", ...type-specific fields..., "confidence": 0.84 }
  },
  "usage": { "input_tokens": 312, "output_tokens": 48 }
}
```

### SDKs [VERIFIED]
- **Python:** `pip install typesafe-sdk` / `uv add typesafe-sdk`; requires Python ≥ 3.10. Exposes `TypeSafeClient` (sync) and `AsyncTypeSafeClient`. Reads `TYPESAFE_API_KEY`; default model `jev-latest`; default base URL `https://api.typesafe.ai`; default per-operation timeout `10.0s`. Entry point `client.system_one(state=..., questions={...})` with `Choice`, `Score`, `Noul` helper types. Also has a Models resource to list account models.
- **JavaScript/TypeScript:** `npm install @typesafe-ai/sdk`; Node ≥ 20; ships ESM, CJS, and TS declarations. Entry point `client.systemOne({ state, questions })` with `choice()` / `score()` / `noul()` helpers that infer answer types.
- **Agent skill:** `claude plugin marketplace add typesafe-ai/skills` or `npx skills add typesafe-ai/skills --skill typesafe-ai`.

**Env vars [VERIFIED]:** `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL`, `TYPESAFE_LOG_LEVEL`.

**Auth model [VERIFIED]:** static bearer API key. No OAuth, no per-request signing, no documented scopes.

---

## 3. Evaluation semantics

### Granularity: one state per call, many questions per call [VERIFIED]
- The only documented endpoint evaluates **one `state`** against a **map of typed questions**.
- Every question in a request sees the **same state**, is evaluated **independently**, and returns an answer under its id.
- **There is no dataset-upload call and no per-row batch endpoint.** Bulk evaluation is done by (a) putting many candidate items into one `state`/criteria and asking one question, and/or (b) sending many questions in one request.
- Questions in the same request are **independent** — one answer is not context for another. Dependent judgments require a **second request**. [VERIFIED]

### Batching in practice [VERIFIED from official cookbooks index]
Official cookbooks demonstrate large "batches" inside a single request:
- score **218** line ids against one query with one Choice question;
- rank **182** skills in one request;
- hierarchical classification via parallel beam search over Choice probabilities.
The number of questions per request is **limited only by the ~32,000-token request budget** (~150,000 chars of English), shared by state + questions. NOT a fixed question count.

**Caveat:** a secondary source claims "up to 255 questions at once." The primary sources say the limit is the token budget; **255 is the documented cap on Choice *options*, not on question count.** Treat the "255 questions" claim as unverified/likely conflated.

### Criteria and modes [VERIFIED]
Three primitives, mixable in one request:
1. **Choice — constrained classification.** Caller defines a label set as a map `option -> description` (`null` allowed). Returns argmax label + full distribution + confidence. **Choice cardinality cap: 255 options**; above that the vendor advises a two-stage score-then-choose pattern.
2. **Score — ordinal mode.** Caller supplies an **ordered array of ≥ 2 level descriptions**. Returns a **probability-weighted score that can fall between levels** (e.g. `1.035` on levels 0/1/2), plus `legend` (index→description), per-level probabilities, and confidence.
3. **Noul — binary/yes-no.** Optional `criteria` describing what true/false mean. Returns a single probability 0..1. **No separate confidence field.**

**Natural-language criteria: YES.** `instructions` (the question) and `criteria` descriptions are natural language, and may be structured JSON.

---

## 4. Output, probability, and calibration

### Per-row output [VERIFIED]
| Type | Fields |
| --- | --- |
| Choice | `choice` (argmax), `probabilities` (map option→float, sums to 1), `confidence` (0..1) |
| Score | `score` (weighted, can be fractional), `legend` (index→level text), `probabilities` (map level→float), `confidence` (0..1) |
| Noul | `noul` (0..1). **No `confidence`.** |

- **No logprobs are exposed** — you get a normalised distribution over *your* options/levels, not token logprobs. [VERIFIED]
- A **distribution is returned for Choice and Score**; a **single probability** for Noul.
- **`confidence` is a derived statistic of the distribution shape** (peaked = confident, flat = uncertain). TypeSafe explicitly says the caller is "never locked into our definition" and gives the raw `probabilities` so you can compute your own measure. [VERIFIED]

### Is the probability calibrated? — the critical finding
- **Vendor claim:** Jev is trained with **RLCD (Reinforcement Learning for Calibrated Decisions)**; marketing states "calibrated probabilities" and "higher confidence means higher accuracy," and that answers are more self-consistent for similar inputs. The blog frames calibration as the *objective function*, distinct from RLHF (human preference) and RLVR (verifiable reward). [VERIFIED as a claim]
- **But primary docs publish no calibration metric or reliability curve.** The official Confidence page instead says thresholds are use-case-specific and instructs the developer to *measure on their own data*: "Start with conservative thresholds, test with your own data, and adjust." [VERIFIED]
- **[INFERRED]** Therefore: `confidence` and `probabilities` are **real, per-answer numeric values** suitable for thresholding, but **calibration on any given customer's distribution is asserted, not demonstrated on a primary source.** The brief's standing constraint ("confidence preserved as a real numeric value, never flattened into false certainty") is *satisfiable* with this API, but any product promise that `confidence = 0.8` means "80% accurate" would be **unverified for your data**.
- **Recommendation for the confidence-model ticket:** no further *external research* is needed to know the API's shape — the API returns a genuine distribution plus a derived confidence, and the docs hand you the raw distribution precisely so you can redefine it. What is **not** obtainable from primary sources is a calibration guarantee or published reliability curve. If the spec depends on calibration being true, that is an **empirical measurement task on our own labelled data**, not a research ticket.

---

## 5. Operational behaviour

### Error shapes [VERIFIED]
JSON body describing the failure. Documented status codes:
| Status | Meaning |
| --- | --- |
| `401 Unauthorized` | Missing/invalid API key |
| `422 Unprocessable Entity` | Validation failure; body details the offending field |
| `429 Too Many Requests` | Rate limit exceeded — back off and retry |
| `529 Overloaded` | Service temporarily overloaded — retry after a short delay |

SDK exception taxonomy (Python) [VERIFIED]: `TypeSafeError` (base) → `TypeSafeAPIError` (carries `status`, `body`, `headers`, `endpoint`, and `request_id` from the `x-typesafe-request-id` response header) with subclasses `TypeSafeBadRequestError` (400), `TypeSafeAuthenticationError` (401), `TypeSafePermissionDeniedError` (403), `TypeSafeNotFoundError` (404), `TypeSafeUnprocessableEntityError` (422), `TypeSafeRateLimitError` (429 — exposes `retry_after_ms` parsed from `Retry-After`), `TypeSafeInternalServerError` (5xx). Connection failures: `TypeSafeAPIConnectionError`; timeouts: `TypeSafeAPITimeoutError`; response-shape failures: `TypeSafeAPIResponseValidationError` with a `field_path` (e.g. `answers.tone.confidence`).

### Retries and timeouts [VERIFIED]
- Docs recommend exponential backoff on `429`/`529`; SDKs do it by default.
- Python `RetryPolicy` defaults: `max_retries=2`, `backoff_initial=0.5s` (doubling), `backoff_max=5.0s`, `backoff_jitter=0.25`, retryable statuses `{408, 429, 500–599}`, `respect_retry_after=True`, retry on connection errors and timeout errors, `timeout=30.0s` total retry budget per call.
- Per-HTTP-operation default timeout: `10.0s` (`DEFAULT_TIMEOUT`).

### Limits [VERIFIED / UNDETERMINED]
- **Rate limits: no numeric value or burst published.** The docs acknowledge a rate limit exists and return `429`, but the threshold/reset window is **[UNDETERMINED]** from primary sources.
- **Max batch:** number of questions bounded only by the ~32,000-token request budget; **Choice options capped at 255**. No documented cap on `state` size beyond the same token budget.
- **Latency:** vendor claims 70–500 ms end-to-end for "System One-shaped queries" (evals run from West Coast laptops — the service is US West based) — vendor-reported, no p95/p99 published.
- **Idempotency: [UNDETERMINED].** No idempotency key, dedup window, or replay semantics appear anywhere in the primary docs. Do not assume at-least-once or exactly-once.
- **Usage reporting:** every response includes `usage.input_tokens` / `usage.output_tokens`. [VERIFIED]
- **Versioning:** `jev-latest` alias; reproducibility across time is not guaranteed by the docs. [VERIFIED]

---

## 6. Commercial

| Item | Value | Status |
| --- | --- | --- |
| Input price | **$0.042 / M tokens** ($42 / billion) | [VERIFIED] |
| Output price | **Free** ("too cheap to meter") | [VERIFIED] |
| Billing unit | per input token; no per-evaluation or per-dataset unit | [VERIFIED] |
| Free tier | none published | [UNDETERMINED] |
| Quotas | none published | [UNDETERMINED] |
| Subsidy | vendor says it cannot prove pricing isn't subsidized, and expects prices to go down | [VERIFIED as a caveat] |

There is no official pricing page at `docs.typesafe.ai/pricing` (404); pricing lives on the vendor blog/homepage. There is no documented public rate card beyond the token price, and no enterprise/volume tier documented.

---

## 7. What this means for the spec (fact, not opinion)

- The **"Jev performs per-row semantic evaluation"** constraint is consistent: one row ⇒ one call, where a row is rendered into `state` and the column definition becomes `instructions` + `criteria`. [INFERRED from primary API shape]
- **Confidence is a first-class numeric output** for Choice (Yes/No classification) and Score (ordinal), with the full distribution also available. Noul has a probability but no `confidence` field — an adapter that assumes `answer.confidence` on every answer will break on binary questions. [VERIFIED]
- **There is no dataset-upload primitive**, so the 10-row preview vs full-run distinction is purely our orchestration (one call per row, or fan-out): [VERIFIED for the API shape; the pipeline split is a design decision for the boundary ticket]
- **Retry/backoff and timeout defaults are known and implementable**, and the SDK does them automatically. We must not invent a rate-limit number — measure it or configure conservatively.
- **Idempotency is undocumented**, so a batch runner must be designed not to depend on it.

---

## Sources

All primary:
- TypeSafe AI vendor site (home): https://typesafe.ai/
- Vendor launch post, "Introducing System One Models & Jev" (15 Sep 2026): https://typesafe.ai/blog/introducing-system-one-models-and-jev
- Quick start: https://docs.typesafe.ai/introduction/quickstart
- API reference: https://docs.typesafe.ai/api
- Primitives (questions): https://docs.typesafe.ai/primitives
- Choice: https://docs.typesafe.ai/primitives/choice
- Score: https://docs.typesafe.ai/primitives/score
- Noul: https://docs.typesafe.ai/primitives/noul
- Confidence: https://docs.typesafe.ai/confidence
- Client SDKs overview: https://docs.typesafe.ai/sdk
- Python SDK: https://docs.typesafe.ai/sdk/python
- Python SDK constants (env vars, defaults): https://docs.typesafe.ai/sdk/python/api/constants
- Python SDK retries (`RetryPolicy`): https://docs.typesafe.ai/sdk/python/api/retries
- Python SDK exceptions: https://docs.typesafe.ai/sdk/python/api/exceptions
- JavaScript / TypeScript SDK: https://docs.typesafe.ai/sdk/javascript
- Docs index (`llms.txt`), used to enumerate every official doc page: https://docs.typesafe.ai/llms.txt
- Official cookbooks index (evidence of single-request batching): https://docs.typesafe.ai/llms.txt (cookbook entries, e.g. `memory_find`, `skill_suggestion`, `hierarchical_classification`)

Explicitly **not** used as evidence (secondary/aggregator/blog coverage found during discovery only): developersdigest.tech, actionbox.cloud, orcarouter.ai, kingy.ai, progressiverobot.com, seangoedecke.com, the-decoder.com, startuphub.ai, top5apps.ai, llmreference.com, swamp-club.com.
