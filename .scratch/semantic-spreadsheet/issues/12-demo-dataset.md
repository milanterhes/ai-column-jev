# Demo dataset and sample rule

**Type:** grilling
**Status:** resolved
**Assignee:** milanterhes
**Blocked by:** —
**Ratification:** ⚠️ **PROVISIONAL — agent-decided under explicit delegation while the human was asleep. Not ratified by a human. Review on waking.**

## Question

Decide the built-in demo so a brand-new user reaches value without uploading anything — the brief requires the product to be understandable from the demo alone.

Settle:

- The 20 fictional companies: which columns (the brief suggests company, description, employee count, country) and how the descriptions are crafted so results are interesting rather than uniform. The set should contain clear yeses, clear nos, and a few genuinely ambiguous rows worth reviewing.
- The sample rule that ships with it — the brief suggests "Is this company a B2B SaaS company?" — and its exact column name, instruction, and type.
- Whether the demo dataset is pre-seeded per user on signup, is a shared read-only dataset, or is created on demand from the landing page.
- Whether the demo's results are pre-computed or evaluated live on the user's first preview (this has a real cost and a real first-impression consequence).
- How the user gets from the demo into their own upload.
- Whether the demo dataset can be deleted like a normal dataset.

## Answer

> ⚠️ **PROVISIONAL — decided by the agent, not the human.** The human was asleep and explicitly delegated. Treat as a draft for review, not a settled decision.

**Columns: `company`, `description`, `employee_count`, `country`** — 20 fictional companies.

**The descriptions carry the teaching load.** The set is built so a newcomer sees the product work: roughly a third unambiguous yeses ("Acme builds HR software for enterprise companies"), a third unambiguous nos ("PixelPop makes consumer photo filters"), and a third **deliberately ambiguous** — agencies, marketplaces, a dev-tools company that sells to businesses but isn't SaaS, a company whose description barely says what it does. The ambiguous third is what makes the demo *honest*: it produces real "needs review" rows, so the confidence model and the review workflow are legible from the demo alone, which the brief demands. A demo where everything is 97% confident teaches the wrong product.

**Sample rule: name `B2B SaaS?`, type Yes/No, instruction "Is this company primarily a B2B SaaS company?"**, pre-filled but fully editable. Its labels are the two fixed Yes/No labels, each with a description that becomes Jev's `criteria`.

**Created on demand, not seeded at signup.** A "Try it with sample data" action creates the dataset for the signed-in user in one step. Seeding every signup costs a write on every registration including the ones that never return, and makes the empty state worse rather than better.

**Evaluated live, not pre-computed.** The user's first preview is a real Jev call on real rows. It costs a fraction of a cent, it proves the integration works end to end on their very first interaction, and pre-computed results would be a lie sitting in a database — the moment a user edits the sample rule, stale results would be indistinguishable from fresh ones.

**It is an ordinary dataset.** It can be renamed, deleted, exported, and added to exactly like an upload. No special-casing anywhere in the product.
