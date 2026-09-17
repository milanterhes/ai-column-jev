Build a production-ready MVP for a self-serve SaaS called **Semantic Spreadsheet**.

## Product concept

The product lets users upload a CSV or XLSX file and add “AI columns” that require human-like judgment.

Examples:
- “Is this company B2B SaaS?”
- “Would this lead fit our ICP?”
- “Is this customer comment a feature request?”
- “Is this feedback likely to indicate churn?”
- “Which category best describes this company?”

The core product metaphor should feel like **Google Sheets + AI judgment columns**, not like a chatbot or workflow builder.

Users should not need to understand prompts, models, schemas, Jev, or LLM internals.

The core flow is:

1. Upload CSV/XLSX.
2. Preview the spreadsheet.
3. Click “+ AI column”.
4. Define what judgment the new column should make.
5. Choose one of three output types:
   - Yes / No
   - Category
   - Score
6. Preview results on 10–20 rows.
7. Edit the rule if needed.
8. Run it over the whole dataset.
9. Filter by results/confidence.
10. Review uncertain rows.
11. Export the enriched CSV/XLSX.
12. Save useful AI columns as reusable rules/templates.

## Core architecture

Use **Jev for bulk semantic evaluation**.

Use **LLMs only for higher-level generative work**, such as:
- explaining why a row received a result,
- helping turn vague user instructions into cleaner evaluation criteria,
- suggesting category labels,
- summarizing patterns across structured results.

Do not use a general-purpose LLM as the default evaluator for every row.

The intended architecture is:

raw row data
→ deterministic preprocessing
→ Jev atomic semantic judgment
→ structured result + probability/confidence
→ deterministic filtering/business logic
→ optional LLM explanation or summary

The app should preserve uncertainty instead of pretending every answer is equally reliable.

## Important UX principle

The central user thought should be:

> “I wish this spreadsheet had one more column, but a human would have to fill it in.”

The product turns that into:

> “+ AI column”

Keep the spreadsheet as the primary interface.

Do not make chat the primary UX.

## Tech stack

Use a pragmatic modern stack that is easy for one founder to maintain.

Preferred:
- Next.js
- TypeScript
- React
- Tailwind
- Postgres
- Prisma or Drizzle
- simple background-job architecture suitable for batch processing
- Stripe-ready billing architecture, even if billing is stubbed initially

For authentication, use the simplest reliable hosted auth option already supported by the project/environment.

For file parsing:
- CSV support is mandatory
- XLSX support is mandatory
- preserve original columns and row ordering
- normalize headers safely
- handle malformed or empty rows gracefully

## Jev integration

Study the current Jev / TypeSafe API and implement against the actual API rather than inventing abstractions that do not map cleanly to it.

Internally, model the three user-facing column types approximately as:

### Yes / No
A binary semantic judgment.

Example:
“Is this company primarily a B2B SaaS company?”

Store:
- selected answer
- probability/distribution if available
- confidence if available
- raw provider response for debugging

### Category
A constrained classification.

Example categories:
- B2B SaaS
- Consumer
- Agency
- Marketplace
- Other

Store:
- selected category
- distribution across categories if available
- confidence
- raw provider response

### Score
A small ordinal scale.

Example:
- Excellent fit
- Good fit
- Weak fit
- Poor fit

Store:
- selected score level
- distribution if available
- confidence
- raw provider response

Do not expose raw Jev implementation details to normal users.

Create an adapter/service layer so Jev could theoretically be swapped later.

Something conceptually like:

evaluateRows({
  rows,
  columnDefinition
})

but design it around the actual Jev API.

## LLM integration

Create a separate LLM service.

Use it only for:
- “Explain this result”
- turning a vague rule into a cleaner structured rule
- suggesting likely categories
- summarizing overall dataset patterns
- optionally helping users improve poor-performing rules

Do not couple core row classification to the LLM.

## Data model

Design a sensible schema around at least:

User

Dataset
- id
- userId
- filename
- rowCount
- originalColumns
- createdAt

DatasetRow
- id
- datasetId
- rowIndex
- originalData JSON

SemanticColumn
- id
- datasetId
- name
- type: boolean | category | score
- instruction
- configuration JSON
- savedRuleId optional
- createdAt

SemanticResult
- id
- rowId
- semanticColumnId
- selectedValue
- confidence
- probabilityData JSON
- status
- explanation optional
- rawProviderData JSON
- createdAt

SavedRule
- id
- userId
- name
- type
- instruction
- configuration JSON

BatchRun
- id
- datasetId
- semanticColumnId
- status
- totalRows
- completedRows
- failedRows
- startedAt
- completedAt

Use judgment on exact schema details.

Avoid storing giant duplicated blobs unnecessarily.

## Main screens

### 1. Landing page

Keep it simple.

Hero:

**Add columns to your spreadsheet that require human judgment.**

Show an example table such as:

Company | Description | B2B SaaS? | ICP Fit?
Acme | HR software for enterprises | Yes 98% | Strong 91%
PixelPop | Consumer photo filters | No 97% | Poor 94%

Primary CTA:

**Upload CSV**

Secondary copy should emphasize:
- no workflow builder,
- no coding,
- structured answers,
- confidence-aware results,
- export when done.

No “Book a demo”.

This is a self-serve product.

### 2. Dataset upload

Drag/drop CSV or XLSX.

After parsing, show:
- filename,
- row count,
- column count,
- first ~20 rows.

Then a prominent:

**+ AI column**

### 3. Add AI column drawer/modal

Fields:

Column name

Question/instruction:
“What should this column determine?”

Output type:
- Yes / No
- Category
- Score

If category:
allow adding/editing category names.

If score:
allow adding ordered levels.

Provide a few contextual example prompts based on existing column names if easy to implement.

Buttons:
- Preview on 10 rows
- Cancel

### 4. Preview mode

Evaluate ~10 representative rows.

Show results inline in the spreadsheet.

Example:

Acme | Yes | 94%
Foo Corp | No | 97%
Vectora | Yes | 58% ⚠

Mark low-confidence rows clearly.

Allow user to:
- inspect result,
- edit rule,
- run on all rows.

Do not run the full dataset before preview confirmation.

### 5. Full batch run

Show progress:

Processing 2,914 / 8,242 rows

Do this asynchronously.

The browser should not need to stay open for processing to complete.

Handle retries and partial failures.

When complete show:

Excellent / Good / Weak etc. summary
High confidence count
Needs review count
Failed count

### 6. Spreadsheet view

Core table should support:
- horizontal scrolling,
- sorting,
- filtering,
- filter by semantic result,
- filter by confidence,
- hide/show columns.

Semantic cells should show:
- value prominently,
- small confidence indicator.

Example:

Strong fit
91%

or:

Needs review
58%

Do not overwhelm the UI with probability vectors by default.

### 7. Row detail / explanation

Click a semantic result.

Show:
- input row values relevant to the judgment,
- selected answer,
- confidence,
- probability breakdown if useful,
- button: “Explain result”.

Only when the user clicks “Explain result” should an LLM-generated explanation be requested.

Example:

Result:
Likely yes — 58%

Explanation:
“The company appears to sell enterprise software, but there is little evidence that engineering teams are the primary buyer.”

### 8. Review uncertain rows

Provide a dedicated review workflow.

Filter rows under a configurable confidence threshold.

Present one row at a time with keyboard-friendly controls.

Example:

Question:
Is this B2B SaaS?

AI:
YES — 62%

[ Yes ] [ No ] [ Skip ]

Keyboard shortcuts:
Y
N
S

Store human corrections separately from model output.

Do not overwrite the original model result.

### 9. Saved rules

Users can save an AI column definition for reuse.

Example:
- B2B SaaS?
- Developer-focused?
- ICP fit?
- Feature request?
- Churn risk?

Allow applying saved rules to a new dataset.

### 10. Export

Export the enriched dataset as CSV.

If practical, also support XLSX.

Include:
- original columns,
- semantic columns,
- optionally confidence columns.

Example:

company
description
ICP Fit
ICP Fit Confidence

## Confidence UX

Confidence is important, but should remain simple.

Default concepts:

High confidence
Needs review
Unable to determine

Internally preserve actual numeric values.

Use sensible default thresholds but make the “needs review” threshold configurable later.

Never imply certainty where there is uncertainty.

## Templates

Include a lightweight template gallery.

Start with around 8 templates.

Possible templates:

Sales
- Is this company B2B SaaS?
- Is this company enterprise-focused?
- Is this lead a strong ICP fit?

Customer feedback
- Is this a feature request?
- Is this likely a bug?
- Does this indicate churn risk?
- Is this complaint urgent?

Research
- What category does this company belong to?

Each template should simply pre-fill an AI column definition.

Do not overbuild a marketplace.

## Usage / credits

Architect for usage-based credits.

Conceptually:

one row × one semantic column = one evaluation

Show expected cost before running a full batch.

Example:

4,218 rows × 3 AI columns
= 12,654 evaluations

For MVP, billing can be mocked or feature-flagged if needed, but usage accounting should be implemented cleanly from the start.

Possible future pricing:
- Free: 500 evaluations
- Starter: 10,000
- Pro: 50,000
- Scale: 200,000

Do not hard-code business assumptions everywhere.

## Important product constraints

This is designed for a solo founder.

Prioritize:
- low operational complexity,
- simple architecture,
- excellent onboarding,
- fast first value,
- low support burden.

Avoid:
- enterprise SSO,
- complex RBAC,
- live collaborative spreadsheet editing,
- Google Sheets integration in v1,
- Airtable integration in v1,
- API in v1,
- chat-first interfaces,
- complicated workflow builders,
- autonomous web research,
- team administration,
- unnecessary microservices.

The MVP should be excellent at one thing:

**Upload a spreadsheet and add reliable semantic columns to it.**

## Security

Treat uploaded datasets as private user data.

Implement:
- user-level data isolation,
- secure file handling,
- no public bucket exposure,
- file size limits,
- safe parsing,
- validation of MIME/file types,
- deletion flow for datasets.

Do not send more row data to external model providers than necessary.

Avoid logging sensitive row content in normal application logs.

## Error handling

Account for:
- malformed CSV/XLSX,
- huge files,
- provider timeouts,
- partial batch failures,
- Jev API failures,
- rate limits,
- invalid category definitions,
- users leaving the page during processing.

A failed subset of rows should not destroy the whole run.

Expose clear retry controls.

## Observability

Add basic structured logging and error tracking hooks.

For every semantic batch, track:
- provider latency,
- success/failure,
- rows processed,
- average confidence,
- error reason,
- estimated usage/cost.

Do not expose sensitive raw data in logs.

## Seed/demo data

Include one built-in demo dataset so users can try the product without uploading anything.

Example:
20 fictional companies with:
- company
- description
- employee count
- country

Provide a sample rule:
“Is this company a B2B SaaS company?”

The product should be understandable from this demo alone.

## Visual style

Clean, sparse, professional.

Think:
- Linear
- Vercel
- modern spreadsheet software

Avoid:
- giant gradients,
- excessive cards,
- chatbot bubbles everywhere,
- “AI sparkle” visual clichés.

The spreadsheet should dominate the product.

## Development priorities

Implement in this order:

1. auth
2. CSV upload/parser
3. dataset storage
4. spreadsheet/table UI
5. AI column schema
6. Jev evaluation service
7. 10-row preview
8. background full-run processing
9. confidence display
10. uncertain-row review
11. CSV export
12. saved rules
13. XLSX import/export
14. template gallery
15. LLM explanation
16. usage accounting
17. polish

Do not spend time on billing until the core evaluation loop works well.

## Acceptance criteria

A brand-new user should be able to:

1. create an account,
2. upload a CSV,
3. see its data,
4. add a Yes/No semantic column,
5. enter “Is this company B2B SaaS?”,
6. preview the result on 10 rows,
7. see confidence values,
8. approve the rule,
9. process the entire CSV,
10. filter rows by answer/confidence,
11. review uncertain rows,
12. export the enriched CSV,

without reading documentation.

## Development approach

Before writing substantial code:

1. inspect the existing repository and conventions,
2. inspect the current Jev/TypeSafe documentation and actual SDK/API,
3. identify any constraints in the existing environment,
4. create a concise implementation plan,
5. then implement end-to-end.

Do not invent fake integrations if credentials are missing.

Where an external service cannot yet be called, create a clean provider interface and a development mock, but clearly mark the mock and keep the real integration path straightforward.

Prefer shipping a complete, coherent vertical slice over many half-finished features.

At the end, provide:
- what was implemented,
- architecture overview,
- environment variables needed,
- local setup instructions,
- known limitations,
- recommended next 5 product improvements.