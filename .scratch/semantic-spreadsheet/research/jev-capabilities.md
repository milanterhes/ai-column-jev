# What else Jev enables — research notes

**Source:** `docs.typesafe.ai` — the index (`llms.txt`), plus the primitives, patterns, use-case map, confidence and build-guidance pages. Fetched 2026-09-17.
**Method:** primary docs only. Page-level claims are attributable to the URLs listed at the end.

---

## 1. The framing correction: Jev is not for building agents

The docs are blunt about this, and it matters for the question:

> "System One is TypeSafe's model for building AI-powered software, **not agents**. It does not generate code or choose its own next action."

The vendor's own contrast is *three architectures*: traditional software (decision tree of reliable primitives), LLM agents (the model chooses its next step; every loop is a chance to go off the rails), and **AI-powered software** (code owns control flow; the model appears only where programmable common sense or unstructured interpretation is needed).

So "AI agents" is the wrong frame. The right one is: **Jev is the reliability layer that makes agents survivable.** In agentic systems it shows up as harness work — routing, guardrails, tool-call verification, skill selection, context retrieval. Every one of those is a cookbook.

**The vendor's five directions** (their words, from the use-case map):

| Direction | Claim |
| --- | --- |
| **AI Automation Software** | Interleave AI with reliable software so it can run a million times in the background with no human co-pilot. Code owns control flow, not markdown files. |
| **Real-time applications** | ~150ms means decisions faster than human perception — programmable games, UI that adapts mid-interaction. |
| **AI Map-Reduce over Big Data** | ~100x cheaper means you can process giant corpora: search, classify whole agent traces, extract features for prediction. |
| **Universal Verification** | Verify *any other AI's* prompts, extractions, reasoning traces and tool calls. Detect jailbreaks, citation errors, hallucinations. |
| **Harness Engineering** | Model routing, semantic context retrieval, LLM error detection and guardrails, reasoning-trace classification. |

## 2. The ten decision shapes

The docs' own taxonomy of what you can ask for — a good checklist when hunting for features:

**Classification** (one known category wins) · **Detection** (probability a property is present) · **Scoring** (position on an ordered rubric) · **Routing** (a category selects the next code path) · **Search** (find items matching a natural-language query) · **Retrieval** (return the most relevant context) · **Ranking** (order items by semantic relevance) · **Verification** (check an artifact for specific failure modes) · **ML feature extraction** (turn text into probabilistic features for a classical model) · **Structured data extraction** (recover known fields from unstructured input).

## 3. The four architectural patterns

| Pattern | What it does |
| --- | --- |
| **Speculative Fan-Out** | Send many questions in one call, including ones that only matter for some inputs, and let code decide what's relevant. |
| **Confidence-Gated Routing** | The answer says *what*; confidence says *whether to act*. |
| **Composite Scoring** | Break a complex judgment into atomic scores; combine with weights you control in code. |
| **Intent Routing** | Classify intent and route to deterministic logic, a specialist LLM, or a human. |

## 4. The eighteen cookbooks

Grouped by what they're really about, rather than listed:

- **Search & ranking** — re-ranking BM25 shortlists (top-1 5%→18%); line-by-line semantic search scoring 218 line ids in one request; classifying RAG passages and dropping prompt-injected ones.
- **Verification** — double-checking citations against sources; LLM guardrails (jailbreak detection + harm severity); verifying tool-call traces.
- **Structure & extraction** — structure recovery (rebuilding Markdown from flattened text); a 2-stage structured-data-extraction cascade; date extraction; pre-parsed value extraction (regex candidates, model selects the span).
- **Classification at scale** — hierarchical classification via parallel beam search over Choice probabilities; classification *using* confidence to pick granularity (report the fine-grained group when confident, the broader division when not); knowledge-graph entity alignment where the three Score levels *are* the three actions (merge / leave / curate).
- **Consistency** — routing uncertain nouls and choices to human review while keeping the raw probabilities visible.
- **Agent harness** — function calling (natural language → typed calls with closed-set arguments); skill suggestion (rank 182 skills in one call, then re-read the top three).
- **ML & research** — autoresearch feature discovery (propose questions, convert text to numeric features, improve a regressor); parallel questions economics (**12.2x cheaper, 10x faster** than one-question-per-call, with unchanged answers).

## 5. What this means for *our* product

### The headline: we use one question per column, and that's the wrong shape

Jev's entire thesis is **many atomic questions per call**. The parallel-questions cookbook measured batching 13 questions into one request as **12.2x cheaper and 10x faster** than 13 calls, with no change in answers. Adding a question is nearly free — it costs only the tokens for that question.

Our product asks exactly one question per AI column, one row at a time. That leaves most of the platform's value on the table.

### Features this unlocks, in rough order of value

1. **Composite columns.** One "ICP fit" column built from three atomic scores — industry fit, size fit, buying-signal strength — weighted in code. The user sees the components *and* the composite, and tunes weights without rewriting the question. This is the Composite Scoring pattern, and it directly fixes the opacity of our Score columns.
2. **Speculative fan-out bundles.** When a user adds "Is this B2B SaaS?", *also* speculatively ask four or five adjacent questions in the same call, then offer the answers as extra columns they can keep or discard. Near-free, and it turns one column into a suggested set — a much better activation loop than an empty "+ AI column".
3. **Confidence-driven granularity.** Our four states ask "is this good enough?" The `classification_using_confidence` cookbook does something better: **report the fine-grained answer when confident and fall back to the broader category when not.** For a sheet that means a taxonomy column that degrades gracefully instead of flagging everything for review.
4. **Hierarchical / taxonomy columns.** Our Category is capped at 255 options by the Choice primitive, but the hierarchical-classification cookbook gets deep hierarchies via beam search over probabilities. That unlocks industry taxonomies, product categories, and deep legal/patent trees.
5. **Verification columns.** A second column type that checks the first: does this row's claim match that row's source? Citation-check, applied to a spreadsheet.
6. **Ranking and search lenses.** Not a per-row judgment at all — "order these 400 rows by relevance to this query" or "which rows match this description". A different mode of use for the same sheet.
7. **Feature-matrix export.** Turn text columns into probabilistic numeric features and export the matrix for a downstream model. A natural upsell and a genuinely different product surface.

### The one that fixes our known bug

We found that a clear bug report scores low sufficiency for "Is this a feature request?" — because the *absence* of feature-request content looks like missing information. The docs name both the cause and the fix:

- **State decomposition** — structure the state and point questions at specific paths with backticked dot-index references, e.g. `ticket.messages[0].text`. We currently send the whole row as flat text.
- **Structured criteria** — Noul accepts criteria as an object with explicit `true` and `false` definitions, each carrying `what`, `not_for`, and `examples`. Defining what "No" means — and what it is *not for* — is exactly what turns absence-of-information from an unknown into a defined answer.

Applying those two is the documented fix for our sufficiency problem, and it needs no new primitive.

## 6. Caveats worth holding

- **Early access.** Jev is a waitlist-era model from a young lab. Anything built on it carries platform risk, and the pricing is explicitly described by the vendor as possibly subsidised.
- **Not an agent framework.** If the goal is autonomous agents, Jev is a component inside the harness, not the product.
- **Several cookbook areas are crowded.** Guardrails, moderation and RAG re-ranking all have well-funded incumbents. The differentiated ground is in owning a *specific workflow* — which is exactly what our spreadsheet product does.
- **Thresholds are yours, and must be measured.** The confidence page is explicit: "The correct threshold values depend on your domain and the performance of the model for your use case. Start with conservative thresholds, test with your own data, and adjust." That is exactly what the sufficiency recalibration did — and it validates treating our 0.8 as a starting point, not a truth.

---

## Sources

- https://docs.typesafe.ai/llms.txt
- https://docs.typesafe.ai/primitives.md
- https://docs.typesafe.ai/confidence.md
- https://docs.typesafe.ai/patterns.md
- https://docs.typesafe.ai/concepts/use-case-map.md
- https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md
- https://docs.typesafe.ai/concepts/state.md *(indexed; not fetched in full)*
- https://docs.typesafe.ai/primitives/advanced.md *(indexed — structure in instructions, criteria and levels)*
- https://docs.typesafe.ai/agent-skill.md *(indexed — drop-in skill for coding agents)*
- Cookbook pages linked from the index: `parallel_questions`, `rerank_typesafe`, `semantic_find`, `citation_check`, `llm_guardrails`, `hierarchical_classification`, `classification_using_confidence`, `entity_alignment`, `function_calling`, `skill_suggestion`, `autoformat`, `sde_cascade`, `date_extraction`, `pre_parsed_value_extraction`, `autoresearch_feature_discovery`, `consistency_noul_cookbook`, `consistency_choice_cookbook`, `classifying_rag_passages`
