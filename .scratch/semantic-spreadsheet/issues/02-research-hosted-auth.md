# Hosted auth options for this stack

**Type:** research
**Status:** resolved
**Blocked by:** —

## Question

What is the simplest reliable **hosted** auth option that actually fits a Next.js + TypeScript + Postgres app maintained by one founder, given this environment?

Survey the realistic candidates (Clerk, Auth.js/NextAuth with a hosted provider, Better Auth, Supabase Auth, WorkOS, Descope) against: hosted vs self-hosted, setup effort, free tier, whether it needs its own database tables or keeps users in an external store, session model, email/password vs magic link vs OAuth, whether local development works without a paid plan, user deletion and data export support, and lock-in.

**Purpose:** this bounds a *constraint* for the spec, not a decision. Q5=A leaves the vendor to the builder, so the spec must require "hosted auth" while stating what the app's own User model and session model imply — in particular whether the app owns a `User` row and what user-level data isolation can rely on.

No vendor is chosen here.

## Answer

Full writeup: `research/hosted-auth.md` (all facts from vendor docs/pricing/repos, fetched 2026-09-17).

**The ticket's candidates split into two families.** *Hosted identity vendors* — Clerk, Supabase Auth,
WorkOS AuthKit, Descope (plus Firebase Auth and Auth0, added because their free tiers justify it) —
store users and sessions in the vendor and satisfy "hosted auth". *Self-hosted TS libraries* — Better
Auth and Auth.js — keep users in the app's own Postgres and do **not**. Notably, **Auth.js is now part
of Better Auth** ("Auth.js © Better Auth Inc. — 2026", with a Migrate-to-Better-Auth guide), and Better
Auth's optional paid "Infrastructure" is a control plane, not a hosted user store.

**Every hosted free tier is far above plausible MVP scale** (Clerk 50k MRU/app; Supabase 50k MAU;
WorkOS AuthKit **1M MAU**; Descope 7.5k MAU; Firebase 50k MAU; Auth0 25k MAU), so the differentiators
are operational, not capacity. Rough shape: Clerk is the lowest-effort Next.js App Router setup but
Hobby pins sessions to 7 days and users live in Clerk's store; Supabase keeps users in the app's own
Postgres (`auth.users` schema, verify with `getClaims`, never `getSession`), and free projects pause
after 1 week idle; WorkOS is the most generous but identity-enterprise-shaped; Descope has the
strictest free caps and no self-serve password-hash export; Better Auth is free and owns the data at
the cost of running auth yourself.

**The spec-relevant conclusion (independent of vendor):** the app must own its own `User` row, keyed by
an app-generated `id`, with the vendor's opaque user id stored as a **unique, immutable**
`vendorUserId`. All business data (`Dataset`, `SemanticColumn`, `SemanticResult`, `SavedRule`,
`BatchRun`) foreign-keys to the internal `User.id`; isolation must never rely on email or vendor
metadata. Sessions are vendor-owned cookies validated **server-side on every request** through a single
server-side accessor returning the internal `User.id` (client-side session state is UI-only). Deleting
a user at the vendor does **not** delete app data — the app must handle the vendor's `user.deleted`
event and cascade its own rows, and the app owns export of its datasets/results/rules.

This bounds the "hosted auth" constraint; no vendor is chosen. Flagged as unverified in the writeup:
WorkOS/Auth0/Firebase export tooling, Descope test-user semantics, standalone Supabase Auth against an
external Postgres, and Clerk preview-domain behaviour.
