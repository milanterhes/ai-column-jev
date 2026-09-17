# Direction — a CPO's read

Written after the research in `research/jev-capabilities.md`, with the product running. This is
opinion, and it contradicts parts of the original brief deliberately.

---

## What this actually is

**Not "an AI spreadsheet". It is judgment at full volume.**

Human review is *sampling*. You read 100 of 5,000 support tickets because reading 5,000 is
impossible — the spreadsheet is the interface for that compromise, and Ctrl+F is the tool. Jev
makes reading all 5,000 cost pennies and take minutes.

So the claim is not "add a column". It is: **stop sampling.** That is a category, not a feature,
and it is the only framing I would build the marketing on.

## The asset we are sitting on and not using

**The corrections.**

Today a correction makes one cell more accurate. But it also creates a **labelled example, for
free, in the user's own definition of the task.** Nobody had to write a spec; the reviewer just
did their job and we kept the receipt.

That corpus is, in order of how soon it pays off:

1. **How we prove accuracy.** "How good is this column?" is the first question every serious
   buyer asks, and every competitor answers it with a vibe. We can answer with a number measured
   on *their* rows.
2. **How we tune thresholds per customer.** TypeSafe's own docs say to measure on your own data.
   We would be doing it automatically.
3. **How the product improves.** Corrections are the training signal for better question wording
   — few-shot at first, and a real dataset if TypeSafe ever supports tuning.
4. **A switching cost.** After 2,000 corrections, leaving means teaching a competitor all of it
   again.

**So the core loop should be review → measure → improve, not fill in a column.** The review
screen stops being a chore and becomes the thing that makes the product trustworthy.

## What I would commit to

**The judgment layer for unstructured rows, with a proof of accuracy — starting with teams who
currently read every row.**

The differentiator is not the model. Anyone can call Jev. It is:

- **Volume economics** — the second column is nearly free (fan-out).
- **A defensible review trail** — model output and human judgment kept separate, never merged.
- **A measured accuracy contract** — published on the user's own data.

## The beachhead

I would pick one recurring review job and own it end to end rather than stay horizontal. My pick:

**Product teams coding customer feedback.** Why this one:

- **It recurs.** Every month. That is the difference between a demo and a subscription.
- **Someone reads all of it today**, and hates it.
- **The criteria are already written down** in someone's head, and they are simple.
- **The buyer is reachable** — a PM or Head of Product — and feels the pain personally.
- **The output feeds a decision** they have to defend, which is exactly what an accuracy report
  is for.
- **We already demo it.** The sample CSV is 35 support tickets. We are closer to this than to
  anything else.

Two runners-up worth revisiting once the loop works: **systematic literature screening** (painful,
explicit criteria, huge volume, but weak buyers) and **verifying AI-generated content at volume**
(a growing problem, and verification is a decision shape Jev is good at).

## Features I would add that are not in the plan

1. **Multi-column chains.** Let a column depend on another: *run this only where that said X.*
   The vendor calls it routing; it cuts cost and fixes the nonsense of judging churn risk on
   rows we already decided were not customers.
2. **The defensible export.** Ship the accuracy report *with* the CSV — a short PDF or an extra
   sheet: what was judged, by what criteria, agreement rate, what was reviewed by a human. The
   artefact leaves the product and lands in a meeting. That is free distribution.
3. **A public count.** "You judged 100% of 50,000 rows." The number that says *stop sampling*.
4. **Templates as proven criteria.** Not a gallery of prompts — a library of criteria that carry
   a measured accuracy and a review history. The brief killed the template gallery; this is a
   different thing and I would build it.
5. **Watch mode.** Save a rule, point it at a recurring export, get judged rows back on a
   schedule. This is the retention feature, and it is the honest half of the deferred connector
   work.

## What I would cut or simplify

- **Collapse the display to two buckets.** Keep four states internally, but a user only needs
  *confident* and *needs your eyes*. "Unable to determine" and "failed" are our vocabulary, not
  theirs.
- **Fold the three column types into one picker.** With composites, Yes/No is a two-label
  unordered set and Score is an ordered one. Three types is a taxonomy of our internals.
- **Drop "calibrated" from every surface, permanently.** We already found confidence behaves
  differently per column type. Sell *measured on your data*, never *calibrated*. The first is a
  promise we can keep.

## Next 90 days

| Weeks | Work | Why |
| --- | --- | --- |
| 1–2 | Milestone 0 (T01–T03) | Two visible defects. Makes the demo honest. |
| 3–6 | Milestone 1 (T04–T08) | Makes the economics work. "The second column is free." |
| 7–10 | Milestone 2 (T09–T11) | Makes it sellable. The accuracy contract. |
| 11–13 | T14, T11, watch mode | Ship to five teams and watch one month of real use. |

Do **not** start Milestone 5 (connectors) before Milestone 2. Sync without an accuracy story is
an expensive way to be ignored on a schedule.

## The risks I would name out loud

1. **The horizontal-tool trap.** "AI columns for any spreadsheet" competes with Clay, with
   ChatGPT, and with copy-paste. Without a beachhead it is a feature, not a company.
2. **Platform risk.** Jev is early access from a young lab, priced possibly below cost. The seam
   is already provider-agnostic — keep it that way and be ready to run a second provider behind
   it. Do not let a Jev-specific shape leak into the domain model.
3. **The "so what" risk.** Producing a column is easy; *proving it is right* is hard. Skip
   Milestone 2 and we have built a toy that gets churned after one upload.
4. **A weak retention surface.** CSV upload gives nobody a reason to return. Saved rules and
   watch mode are not polish; they are the business.
5. **Overselling confidence.** This is the one that would cost us trust fastest, and we have
   already seen it invert once by column type.

## The single sentence I would put on the site

> Upload a spreadsheet. Tell us the judgment you need. We'll judge every row, show you exactly
> how confident we are, and prove how accurate we were on the rows you checked.
