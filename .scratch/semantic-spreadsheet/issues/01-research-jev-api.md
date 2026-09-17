# The real Jev / TypeSafe evaluation API

**Type:** research
**Status:** resolved
**Blocked by:** —

## Question

What does the actual **Jev / TypeSafe** API offer, precisely? Establish everything against primary sources — official docs, API reference, SDK source — not blog posts or hearsay.

- **Identity and availability:** what "Jev" is, who makes it, its relationship to TypeSafe, whether it is public/GA, and how access and credentials are obtained.
- **Interface:** HTTP endpoints and/or SDKs (language, package names), the authentication model, request shape, response shape.
- **Evaluation semantics:** does it evaluate one row per call, in batches, or a dataset uploaded once? Are criteria expressed as natural-language instructions? Is there a constrained-classification mode (fixed label set) and an ordinal mode?
- **Output:** what comes back per row — a label, a probability, logprobs, a distribution across labels, a confidence? Is the probability calibrated?
- **Operational:** rate limits, max batch size, concurrency, timeout behaviour, retry semantics, error shapes, idempotency.
- **Commercial:** pricing and its unit (per evaluation, per token, per dataset), free tier.

**Required finding:** enough depth on probability/confidence semantics to decide whether a further research ticket is needed.

If "Jev" cannot be identified as a real, callable product, say so explicitly and report the closest real candidates. Do not invent an API.

## Answer

**Headline: Jev is real.** Jev is the first public **System One Model** from **TypeSafe AI**, in **early access / waitlist** since 15 Sep 2026. Endpoint `POST https://api.typesafe.ai/v1/systemone`, bearer API key, model alias `jev-latest`. Console/keys at `console.typesafe.ai`. Python SDK `typesafe-sdk`, JS/TS SDK `@typesafe-ai/sdk`. Pricing: **$0.042/M input tokens ($42/billion), output free**. "TypeSafe" is the company, not a second product.

**It is not a dataset-upload or batch service.** The only endpoint evaluates **one `state`** (string or structured JSON) against a **map of typed questions**, all sharing that state, evaluated independently and in parallel. No per-row endpoint, no dataset upload. Bulk work = many items inside one state/criteria and/or many questions per request; question count is bounded only by the **~32,000-token request budget** (~150k English chars). Choice *options* are capped at **255**.

**Three primitives (all natural-language `instructions`, structured `criteria` allowed):**
- **Choice** — constrained classification over a caller-defined label set → `choice` (argmax), `probabilities` (sums to 1), `confidence`.
- **Score** — ordinal mode over an ordered array of ≥2 level descriptions → `score` (weighted, can land between levels), `legend`, `probabilities`, `confidence`.
- **Noul** — yes/no → `noul` (0..1). **No `confidence` field** — adapters must not assume it.

So: constrained classification **yes**, ordinal mode **yes**, natural-language criteria **yes**.

**Probability/confidence (decisive for the confidence ticket):** Choice/Score return a genuine distribution plus a derived `confidence` (0..1, peakedness of that distribution); TypeSafe says you may define your own measure and gives the raw `probabilities`. No token logprobs. Calibration is a **vendor claim** (trained with RLCD; "higher confidence = higher accuracy"); the official Confidence page publishes **no calibration metric/reliability curve** and tells you to test thresholds on your own data. **Conclusion: a further research ticket is NOT needed on API shape or probability semantics — the API and its confidence model are fully pinned. Whether `confidence` is calibrated on our data is an empirical measurement task, not research.**

**Operational (verified):** errors `401`, `422` (body names offending field), `429` (rate limit — **no numeric limit published**), `529` overloaded; JSON error bodies; SDK exposes `request_id` via `x-typesafe-request-id`. Retries via exponential backoff; Python `RetryPolicy` defaults `max_retries=2`, `backoff_initial=0.5s`→`max 5.0s`, jitter 0.25, retries on `{408,429,500–599}`, honours `Retry-After`, 30s total budget; default per-request timeout 10s. **Idempotency is undocumented** — do not assume it. Latency 70–500ms (vendor). Usage returned per response.

**Undetermined / not to be invented:** numeric rate limits and reset window, free tier, quotas, SLA, idempotency semantics, and any calibration guarantee. Full detail, with each fact labelled verified/inferred/undetermined, in `.scratch/semantic-spreadsheet/research/jev-api.md`.
