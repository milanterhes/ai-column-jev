# Hosted auth options for a Next.js (App Router) + TypeScript + Postgres app

**Date:** 2026-09-17
**Ticket:** `issues/02-research-hosted-auth.md`
**Type:** research (bounds a constraint; does **not** choose a vendor)

## Purpose

This document bounds the **"hosted auth"** constraint for the Semantic Spreadsheet spec. It answers
the question *"what is the simplest reliable hosted auth option for a Next.js + TypeScript + Postgres
app maintained by one founder?"* by surveying the realistic candidates against the same axes, and — more
importantly for the spec — states **what the app itself must own regardless of which vendor is picked**.

No vendor is selected here. Vendor-shaped implementation choices are left open by the map; the spec only
needs to say *"hosted auth"* and then describe what the app's own `User` model and session model imply.

**Method:** every claim below is taken from the vendor's own docs, pricing page, or official repo,
fetched 2026-09-17. Secondary sources were not used to establish facts, with three explicitly-flagged
exceptions. Anything I could not verify from a primary source is marked **[UNVERIFIED]**.

---

## Headline facts

1. **The six candidates collapse into two families.**
   - **Hosted identity vendors** (users/sessions live in the vendor): **Clerk**, **Supabase Auth**,
     **WorkOS AuthKit**, **Descope**. These satisfy "hosted auth" in the strict sense. Firebase Auth
     and Auth0 are the same shape and were added as realistic alternates.
   - **Self-hosted TypeScript libraries** (users/sessions live in *your* Postgres): **Better Auth** and
     **Auth.js**. These do **not** satisfy "hosted auth" on their own. This matters because the ticket
     lists Auth.js and Better Auth as candidates, and in 2026 the distinction has shifted: **Auth.js is
     now part of Better Auth** (Auth.js docs footer: "Auth.js © Better Auth Inc. — 2026", plus a
     "Migrate to Better Auth" guide). Better Auth also now sells an optional *hosted control plane*
     ("Infrastructure": dashboard, audit logs, security detections) — but that is **not** a hosted user
     store; the framework and the user data remain self-hosted.

2. **Every free tier is far above plausible early-MVP scale for a solo founder.** Any of the hosted
   vendors can carry a first cohort with no spend: Clerk 50,000 MRU/app, Supabase 50,000 MAU, WorkOS
   AuthKit **1,000,000 MAU**, Descope 7,500 MAU, Firebase Auth 50,000 MAU, Auth0 25,000 MAU. The
   differentiators are therefore *operational*, not capacity: user-store location, session mechanics,
   deletion/export behaviour, and exit cost.

3. **The spec-relevant constraint is the boundary, not the vendor.** With *every* hosted candidate the
   app must still own a local `User` row keyed by an internal id, store the vendor's user id as a unique
   external key, key all business data off the internal id, verify the session server-side on every
   request, and orchestrate its own deletion/export. Only *where identity lives* changes; *what the app's
   `User` model means* does not. That conclusion is expanded next and is the main deliverable.

---

## What the app must own regardless of vendor (the conclusion the spec needs)

This is the part that does not depend on the vendor choice. The spec can state these as requirements on
the app's data and session model, and the builder can satisfy them with any hosted vendor.

1. **The app owns its own `User` (or `AccountUser`) row.** Even when the vendor is the system of record
   for *identity*, the app's own entities (`Dataset`, `SemanticColumn`, `SemanticResult`, `SavedRule`,
   `BatchRun`) are keyed by a user and need referential integrity and cascade semantics. The app must not
   foreign-key directly to a vendor-side id it does not control. Schema implication:
   - `User.id` — app-owned primary key (UUID or similar), stable forever.
   - `User.vendorUserId` — the vendor's opaque id (`user_…` / UUID / `sub`), **unique and immutable**;
     this is the join key to the auth vendor.
   - `User.email`, `User.createdAt` — informational mirrors, not identity. **Never key isolation off
     email**, since emails can change and vendors allow multiple identities per user.
   - `User.authProvider` (optional) — which vendor/instance created the row.

2. **All business data isolates by the internal `User.id`.** Every query is scoped by
   `User.id`, and every child table carries `userId` (directly or via its parent). This is the only
   thing user-level data isolation can rely on. It must not rely on the vendor's session object,
   email, or metadata.

3. **The app owns a single server-side session seam.** The vendor issues a cookie/session; the app must
   **verify it server-side on every request** (SDK helper or JWT verification) and expose exactly one
   server-side function that returns the current internal `User.id`. Client-side session state is for UI
   only and must never be trusted for authorization. This is true for every candidate (Clerk's
   `auth()`/session token, Supabase's `getClaims()` — *not* `getSession()` — WorkOS/Descope JWT
   validation, Better Auth's `getSession`). The session object is vendor-owned; the app should derive
   only *"who"*, and should not store app state in it.

4. **The app owns deletion orchestration.** Deleting a user at the vendor does **not** delete the
   app's data. The app must react to a vendor `user.deleted` event (webhook) and cascade-delete (or
   anonymize) its own rows. Conversely, an in-app "delete my account" flow must call the vendor's
   delete API **and** delete local data; doing only one leaves orphaned rows or a live login.

5. **The app owns export.** The vendor's export covers *identity records only* (profile, sessions,
   sometimes password hashes). The user's actual dataset content, semantic results, and saved rules live
   in the app's Postgres and can only be exported by the app. The spec's deletion/export lifecycle
   ticket (`10-dataset-privacy-lifecycle`) is therefore partly about the app's own DB, not the vendor.

6. **Do not use vendor metadata as a data store.** Clerk's own docs warn to store extra user data in
   your own database rather than in session-token/metadata claims (4 KB cookie limit, rate limits).
   The same principle applies to Descope custom attributes and WorkOS user metadata: treat them as
   small convenience mirrors, not as the app's data.

**One-line summary for the spec:** *"Auth is hosted, but identity is mirrored: the app owns a `User`
row keyed by an app-generated id with the vendor's user id stored as a unique external key; all data
isolation, deletion, and export are the app's responsibility, and sessions are verified server-side."*

---

## Comparison at a glance

| Candidate | Hosted? | User records live in | Session model | Free tier (exact, 2026-09-17) | Paid entry | App owns a `User` row? |
|---|---|---|---|---|---|---|
| **Clerk** | Hosted only | Clerk's store | Short-lived JWT cookie (`sub` = user id); Hobby fixed 7-day lifetime | 50,000 MRU per app, unlimited apps, 3 dashboard seats; social ≤3; no MFA/passkeys/custom session length | $25/mo ($20 annual) | Yes — mirror via webhook |
| **Auth.js / NextAuth** | **No** (library) | Your Postgres, only if a DB adapter is added; otherwise JWT-only | JWT cookie by default; DB sessions with adapter | Framework free; no hosted user store | n/a (self-host) | Only if adapter added |
| **Better Auth** | **No** (library; optional hosted *control plane*) | Your Postgres (`user`,`session`,`account`,`verification`) | Cookie `session_token`, DB-backed by default, 7-day default; optional signed cache / stateless JWE | Framework free & OSS; hosted control plane Starter $0 | Control plane Pro $20/mo | Yes — it *is* the app's table |
| **Supabase Auth** | Hosted **or** self-host (Docker/CLI) | Your Supabase Postgres (`auth.users` schema), same DB as app tables | Cookie `sb-<ref>-auth-token`; access JWT (~short) + refresh token; verify with `getClaims()` | 50,000 MAU; 500 MB DB; 2 projects; projects pause after 1 week inactivity; built-in email 2/hour | $25/mo (100k MAU, then $0.00325/MAU) | Yes — mirror `auth.users` into `public` profile row |
| **WorkOS AuthKit** | Hosted (hosted UI or headless) | WorkOS's store | Access token + refresh token, validated by your backend; refresh persisted server-side | Up to **1,000,000 MAU**; staging free | $2,500/mo per additional 1M MAU; custom domain $99/mo (optional) | Yes — mirror via Events API/webhooks |
| **Descope** | Hosted | Descope's store | Short-lived session JWT + longer refresh JWT; refresh in HttpOnly cookie on web | 7,500 MAU; 10 tenants; 3 SSO conn.; 5 test users; 1,000 emails/day; custom domain included | $249/mo (10k MAU) | Yes — mirror via connectors/webhooks |
| **Firebase Auth** *(added)* | Hosted only | Google's store | Firebase ID token (JWT) + refresh token, verified with Admin SDK | 50,000 MAU on no-cost Spark plan; email/social no-cost; phone billed per SMS | Pay-as-you-go (Blaze) | Yes — mirror via Admin SDK |
| **Auth0** *(added)* | Hosted only | Auth0's store | Cookie session (OIDC); ID/access token + refresh | 25,000 MAU; 1 custom domain; passwordless; social; 1 enterprise connection | $35/mo B2C Essentials (500 MAU) | Yes — mirror via Management API / Actions |

---

## Per-candidate findings

### Clerk

- **Hosted vs self-hosted:** Hosted only (no self-host option). Development and production are separate
  *instances*; every app gets both.
- **Setup effort (Next.js App Router):** Lowest of the group. `npx clerk@latest init` detects Next.js and
  writes the SDK, provider, middleware/proxy file, and dev keys to `.env.local`; no Clerk account is
  required to start. Manual path is `@clerk/nextjs` + `clerkMiddleware()` + `<ClerkProvider>`.
- **Free tier:** Hobby — 50,000 MRU per app, unlimited apps, up to 3 dashboard seats. Hobby forces a
  **fixed 7-day session lifetime**, up to 3 social connections, and excludes MFA, passkeys, custom
  password rules, custom email templates, user bans, and simultaneous sessions. "First Day Free": a user
  only counts as retained after returning ≥24h later, so raw signups are cheaper than MAU.
- **Where user records live / does the app own a User row?** In Clerk's store. Clerk's session token
  carries `sub` = `user_…`; the app has no user table unless it creates one. Clerk's own guidance is to
  store extra user data in your own database and sync via webhooks. → **App must create and maintain its
  own `User` row** via the `user.created`/`user.updated` webhooks, keyed by `vendorUserId = sub`.
- **Session model:** Short-lived **JWT stored in a cookie**, validated by Clerk middleware on every
  request; `auth()` (server) returns `{ isAuthenticated, userId }`. Older `getAuth()` still exists. The
  cookie must stay under the ~4 KB browser limit.
- **Sign-in methods (Hobby):** email + password, email codes, **email magic links**, usernames, up to 3
  social OAuth providers, sign-in tokens, Web3 wallets, automatic account linking. SMS, passkeys, MFA,
  and custom session lifetime are Pro+.
- **Local dev & previews on free tier:** Yes. Development instances are free and expose *all Pro
  features* for testing. For preview deployments the documented free path is to configure preview
  deployments with **development API keys** (host-provided `*.vercel.app` domain); sharing production
  users with previews requires Vercel Pro's Preview Deployment Suffix (a paid host feature). Production
  needs a production instance, your own domain, DNS records, and `pk_live_`/`sk_live_` keys.
- **Deletion & export:** Single-user delete via Dashboard or `clerkClient.users.deleteUser()`. **Bulk
  deletion is not self-serve** — Clerk directs you to support. Export: Dashboard "Export users" downloads
  a CSV that **includes hashed passwords** (plus export history logs); Backend `GetUserList` for programmatic.
- **Lock-in / exit cost:** Moderate. User records are proprietary and ids are Clerk-shaped, but the
  hashed-password export makes a real migration possible; a published migration guide and schema notes
  exist (e.g. keep the legacy id as `external_id`). Active sessions are vendor-managed, so cutover ends
  existing sessions.

### Auth.js / NextAuth

- **Hosted vs self-hosted:** **Not hosted.** Auth.js is an open-source library (`next-auth` v5 beta and
  `@auth/*`). There is no Auth.js service and no Auth.js user store. The ticket's phrasing "Auth.js
  hosted provider" only means the *external OAuth/magic-link provider* is hosted while Auth.js manages
  the session in your app.
- **2026 status — important:** The Auth.js project is now **part of Better Auth** ("Auth.js © Better Auth
  Inc. — 2026"; a "Migrate to Better Auth" guide ships in its docs). Treat Auth.js as legacy-adjacent:
  new work is steered toward Better Auth.
- **Setup effort (Next.js App Router):** Moderate. Add `auth.ts` + a route handler + middleware; for
  persistence you must add a **database adapter** (Prisma, Drizzle, Postgres, Neon, Supabase, Kysely,
  …) and run its migrations. Credentials (email+password) is a provider but explicitly DIY and not the
  recommended path; there is no built-in password reset/verification email flow.
- **Free tier:** Free/open source; there is no hosted free tier to compare.
- **Where user records live / does the app own a User row?** Only if you add a database adapter, in
  which case users/sessions/accounts are written to **your own Postgres** via the adapter's fixed schema.
  Without an adapter, JWT-cookie sessions carry identity but nothing is persisted.
- **Session model:** JWT session cookie by default; database sessions when an adapter is configured.
- **Sign-in methods:** OAuth (many providers), Magic Links (needs your own email provider), Credentials
  (username/password, DIY), WebAuthn (experimental).
- **Local dev & previews:** Free and unrestricted — it's your code and your DB.
- **Deletion & export:** Whatever you implement; data is in your DB.
- **Lock-in / exit cost:** Low (open source, your DB) — but you carry the operational and security
  burden of running auth, which is the opposite of the ticket's "hosted" constraint.

### Better Auth

- **Hosted vs self-hosted:** **Self-hosted framework** ("Your auth lives in your codebase") — a
  framework-agnostic TS auth library. It also sells an optional hosted **control plane** called
  Infrastructure (dashboard, audit logs, security detections, transactional email/SMS, self-service SSO)
  — that is *not* a hosted user store. The pricing page says it plainly: "The Better Auth framework is
  free and open source. Pricing below is for our managed infrastructure."
- **Setup effort (Next.js App Router):** Low-to-moderate. `betterAuth()` config plus a catch-all route
  (`/api/auth/*`), a client, and a DB. Ships a CLI (`auth generate` / `auth migrate`) that emits the
  schema for Kysely/Prisma/Drizzle and can run migrations; a Next.js integration covers server-action
  cookie handling.
- **Free tier:** Framework free and open source. Infrastructure Starter $0 (1 dashboard seat, 10,000
  audit logs/month, 1-day retention, 1,000 security detections/month). Pro $20/mo (unlimited seats,
  20,000 audit logs, email/SMS billing at $0.001/email and $0.09/SMS, 1 SSO connection). None of this is
  required to run auth.
- **Where user records live / does the app own a User row?** **Your Postgres, directly.** Core tables:
  `user`, `session`, `account` (one row per linked auth method; credentials live here, not on `user`),
  `verification`. Passwords are hashed with `scrypt` (OWASP-recommended; Argon2 pluggable). The app's
  `User` row literally is Better Auth's `user` row — no mirroring needed. Additional fields can be added
  to the user/session schema and are typed through `useSession`/`signUp`.
- **Session model:** Traditional cookie-based sessions: an opaque `session_token` cookie pointing at a
  `session` DB row (7-day default, sliding `updateAge` 1 day). Optional `cookieCache` stores a signed
  cache cookie (`compact`/`jwt`/`jwe`); optional fully stateless mode with no DB. Sessions are listable
  and revocable (`revokeSession`, `revokeOtherSessions`, `revokeSessions`).
- **Sign-in methods:** Email + password built in (enable `emailAndPassword`); **magic link** is a
  plugin (`magicLink({ sendMagicLink })`, 5-minute default expiry, single-use); OAuth via built-in
  `socialProviders` (Google, GitHub, …); passkeys, 2FA, multi-session, SSO, etc. as plugins. Email
  sending is **your** responsibility (your SMTP/Resend/etc.), or pay the control plane $0.001/email.
- **Local dev & previews:** Free and unrestricted; no vendor keys needed. Works anywhere Next.js runs
  (including preview deploys) as long as a DB is reachable.
- **Deletion & export:** You own the tables, so deletion/export are ordinary SQL; `databaseHooks` expose
  `user.delete` before/after hooks for cascades. No vendor export to request.
- **Lock-in / exit cost:** Essentially zero (open source, your schema, your data). The trade is that you
  own uptime, security patching, email deliverability, and session infrastructure — precisely the
  operational load a solo founder is told to avoid.

### Supabase Auth

- **Hosted vs self-hosted:** Hosted on Supabase Cloud **or** self-hosted (Docker/CLI). Free "projects"
  are the normal path. Auth is GoTrue; the free tier includes it.
- **Setup effort (Next.js App Router):** Moderate. `@supabase/ssr` + `@supabase/supabase-js`, two client
  factories (browser/server), and a **proxy/middleware file** that refreshes the token and writes cache
  headers. The docs are explicit that on Next.js ≤15 the file must be `middleware.ts` and on 16+ it is
  `proxy.ts`, or sessions silently never refresh.
- **Free tier:** 50,000 MAU; 500 MB database; 5 GB egress; 1 GB file storage; 2 active projects;
  **free projects pause after 1 week of inactivity**; built-in email is limited to **2 emails/hour**
  unless you configure custom SMTP or a Send Email hook; auth audit logs 1 hour; SAML SSO and advanced
  MFA are paid.
- **Where user records live / does the app own a User row?** **In your own Postgres**, in the managed
  `auth.users` schema. Because Supabase *is* the app's Postgres in the common case, the app effectively
  owns the database — but `auth.users` is not meant to hold app profile fields. The normal pattern is a
  `public.profiles`/`public.users` row (same UUID) populated by a trigger on `auth.users`, which is the
  row the app's foreign keys reference. `id` is the user's stable UUID; `email`, `phone`,
  `email_confirmed_at`, `last_sign_in_at`, `app_metadata`, `user_metadata`, `identities` are exposed.
  Note: `user_metadata` is user-editable and must **not** be used for authorization.
- **Session model:** Cookie-based (`sb-<project_ref>-auth-token`) via `@supabase/ssr`; short-lived access
  JWT + refresh token, refreshed in middleware. The docs stress using **`getClaims()`** to verify a page
  or data, `getUser()` for a fresh network-confirmed record, and **never trusting `getSession()`** on the
  server (it does not revalidate). With asymmetric signing keys (default for new projects) verification
  is local against cached JWKS.
- **Sign-in methods (Free):** email + password, passwordless email (magic link / OTP), phone OTP,
  unlimited social OAuth providers, anonymous sign-ins, basic MFA; SAML 2.0 SSO is paid.
- **Local dev & previews:** Excellent local dev — `supabase start` runs Postgres + Auth + Storage in
  Docker, free, and does not consume project quota. For previews, production-style branching is a Pro+
  paid add-on ($0.01344/branch/hour); the free workaround is a second free project, but free projects
  **pause after 1 week of inactivity**, which can bite a low-traffic preview.
- **Deletion & export:** Admin API (`supabase.auth.admin.deleteUser`) for user deletion; app data is
  yours via SQL/`pg_dump`. Supabase's pricing table lists "User data ownership: Included".
- **Lock-in / exit cost:** Low-to-moderate. Auth is open source (GoTrue) and self-hostable, and user
  data sits in a standard Postgres schema, so the exit is a database export rather than a vendor
  negotiation. The cost of leaving is disentangling from Supabase's client libraries, RLS conventions,
  and the coupled DB/Auth/Storage platform.

### WorkOS AuthKit

- **Hosted vs self-hosted:** Hosted (a hosted, themeable AuthKit UI, or headless using the User
  Management APIs with your own UI).
- **Setup effort (Next.js App Router):** Low. `npx workos@latest` provisions environments and wires the
  integration; framework-specific guides and an `@workos-inc/authkit-nextjs` package exist. Sessions
  can be handled with their framework middleware or the newer `@workos/authkit-session` toolkit (marked
  **prerelease** — APIs may change).
- **Free tier:** **Up to 1,000,000 MAU free** for User Management/AuthKit; staging environments are free
  to test; then **$2,500/mo per additional 1M MAU**. Custom domain (AuthKit, Admin Portal, email sender)
  is an optional **$99/mo** add-on — AuthKit otherwise runs on a WorkOS `*.authkit.app`-style domain.
  Support is free (Standard); a $1,000/mo Scale support plan exists.
- **Where user records live / does the app own a User row?** In **WorkOS's** store — users appear in the
  WorkOS Dashboard, and `sub` is the WorkOS user id. WorkOS actively markets the mirror pattern: "Use
  the Events API to sync users to your DB … Keep your user data in your user table." → **App must own a
  `User` row**, synced via webhooks (`user.created`, etc.), keyed by `vendorUserId = sub`.
- **Session model:** OAuth-like **access token + refresh token**. The access token (JWT with `sub`,
  `sid`, `iss`, optional `org_id`, `role`) is stored as a secure cookie and validated by your backend on
  each request; the refresh token is persisted server-side or in a secure cookie and exchanged for a new
  access token. Session length, access-token duration, and inactivity timeout are configurable in the
  dashboard. Their framework layer encrypts the session into a cookie (`iron-webcrypto`).
- **Sign-in methods:** Email + password, social login, magic auth (6-digit code), MFA, and enterprise
  SSO — all from one integration; email verification on by default; identity linking/merging.
- **Local dev & previews:** Staging is free and fully featured; production is billed only on real MAU.
  Preview/staging deployments can run on the free staging environment. No paid plan is needed to develop.
- **Deletion & export:** Users are deletable through the API/dashboard; the **exit-export story was not
  fetched in this pass** — assume a Management API `listUsers` export plus per-user deletion.
  **[UNVERIFIED: WorkOS bulk user export and password-hash export].**
- **Lock-in / exit cost:** Moderate. The identity record is WorkOS's, so exiting means a migration; the
  saving grace is that WorkOS expects you to keep your own user table in sync, so your business data is
  already keyed to your own rows. The free 1M MAU ceiling makes cost-based exit unlikely for an MVP.

### Descope

- **Hosted vs self-hosted:** Hosted CIAM platform (hosted flows/UI, SDKs, APIs). Not self-hostable.
- **Setup effort (Next.js App Router):** Low-to-moderate. Client + backend SDKs, flows hosted in the
  Descope console; a React SDK exists. Backend session validation is explicit and required on protected
  routes.
- **Free tier (Free Forever):** 7,500 MAU; 10 active tenants; 3 SSO connections; 1 federated app (OIDC);
  5 test users; 10,000 M2M exchanges; 2,000 MACs; 2,000 MATKs. **All auth methods included**, custom
  domain included, no Descope watermark, community support, 99% SLA. Email delivery via Descope is
  capped at 1,000/day (or bring your own connector); SMS/voice capped at 100/month with Descope's
  connector. Exceeding any of MAU/tenants/SSO limits forces the Pro tier.
- **Paid:** Pro from **$249/mo** (10,000 MAU, 35 tenants, 5 SSO connections), Growth from $799/mo; an
  early-stage "Hello World" startup plan can grant Pro free for a year.
- **Where user records live / does the app own a User row?** In **Descope's** store. Descope assigns an
  immutable `userId` (you cannot set it) and stores login IDs, profile fields, roles, tenants, custom
  attributes, and auth state. → **App must own a `User` row**, synced by webhooks/connectors, keyed by
  `vendorUserId = Descope userId`.
- **Session model:** Two signed JWTs: a **short-lived session token** for API requests, validated by your
  backend, plus a **longer-lived refresh token** the client SDK uses to mint new session tokens. On web
  the refresh token is typically an HttpOnly cookie; mobile uses Keychain/EncryptedSharedPreferences.
  The docs are emphatic that client-side checks are not authorization.
- **Sign-in methods:** Every method is on the free tier: email + password, email magic links, email OTP,
  social login, passkeys/biometrics, authenticator apps, SSO (SAML/OIDC, 3 connections), etc.
- **Local dev & previews:** Free tier includes **5 "test users"** and test-user management APIs for
  local/dev; preview deployments work against the project. The 5-test-user cap is a mild local-dev
  constraint. **[PARTIALLY VERIFIED: the exact test-user semantics were inferred from the pricing page
  and the Test Users docs index; not read in full.]**
- **Deletion & export:** Single and **batch delete** users via the Management API. Export via the
  `Search Users` API or backend SDK `searchAll()` (returns JSON user objects), or a console CSV export.
  **Hashed passwords are not available via the API** — Descope says contact support for a secure CSV
  transfer. That is the main exit friction.
- **Lock-in / exit cost:** Moderate-to-high. Users, roles, tenants, and auth methods live in Descope;
  the profile export is good but the credential (password hash) export needs support, so a migration
  cannot be fully self-served.

### Additional candidates considered (added because primary sources justify them)

**Firebase Authentication (Google) — hosted.**
Free "Spark" plan: **50,000 MAU** for "other authentication services" with Identity Platform, plus
50 SAML/OIDC MAU; email/password and social are no-cost; phone auth is billed per SMS. Users live in
Google's store; sessions are Firebase ID tokens (JWTs) + refresh tokens verified with the Admin SDK.
Email/password, email-link, phone, and many OAuth providers are supported. Local development and
preview deploys work without billing; **App Hosting** requires a billing account but auth does not.
Included here because it is a realistic, genuinely free-at-MVP hosted option; **deletion/export
tooling was not verified in this pass [UNVERIFIED]**.

**Auth0 (Okta) — hosted.**
Free plan: **up to 25,000 MAU**, 1 custom domain (credit-card verification required), passwordless,
unlimited social connections, 5 organizations, 1 enterprise connection, self-service SSO. Users live in
Auth0's tenant store; sessions are OIDC cookie sessions with ID/access/refresh tokens. Paid B2C starts
at **$35/mo** for 500 MAU; B2B at $150/mo. Realistic, but the free tier is smaller than the others and
the platform is heavier than a solo founder needs. **Export/deletion tooling not verified in this pass
[UNVERIFIED]**.

**Dropped / not pursued:** AWS Cognito (free tier exists but setup and UX are widely regarded as heavy
for this stack; not verified here), Ory, Logto, Keycloak (self-hosted, violates "hosted"), and
Clerk/Auth0/Supabase B2B add-ons (SSO/RBAC/teams are explicitly out of scope on the map).

---

## Implications for the spec (constraint wording)

The spec should **not** name a vendor. It should state the constraint and the invariants the app must
satisfy with any vendor:

- **Constraint:** Authentication is provided by a **hosted** identity service (the app does not run its
  own identity server). The vendor is a builder choice.
- **Identity mirroring:** The app maintains its own `User` row with an app-owned primary key and a
  unique, immutable `vendorUserId`. All business entities reference the app's `User.id`.
- **Session:** The app verifies the hosted session **server-side on every request** through a single
  server-side accessor that returns the current `User.id`; client-side session state is UI-only.
- **Isolation:** Every read/write is scoped by `User.id`; isolation never relies on email or vendor
  metadata.
- **Lifecycle:** Account deletion and data export are the app's responsibility; the app handles the
  vendor's `user.deleted` event and cascades its own data, and exposes its own export of datasets,
  results, and rules.
- **Deferred to the builder:** which vendor, its free-tier limits, and its specific SDK. The spec can
  note that all surveyed hosted vendors exceed plausible MVP scale on their free tiers.

---

## Not verified / open flags

- **[UNVERIFIED]** WorkOS bulk user export and whether password hashes are exportable.
- **[UNVERIFIED]** Firebase Auth user export/deletion tooling (e.g. `firebase auth:export`).
- **[UNVERIFIED]** Auth0 user export/deletion tooling in this pass.
- **[PARTIALLY VERIFIED]** Descope "test users" semantics and local-dev story (pricing page lists
  5 test users on Free; the dedicated docs page was not read in full).
- **[PARTIALLY VERIFIED]** Supabase Auth used *standalone* against a non-Supabase Postgres (e.g. a
  separate Neon database). The default and documented path couples Auth to the project's own Postgres;
  a standalone-Auth + external-DB topology was not confirmed from docs in this pass.
- **[UNVERIFIED]** Clerk's exact behaviour when a preview deployment's dev instance is used with a
  custom preview domain; the documented free path uses the host's `*.vercel.app` domain with dev keys.
- All pricing and free-tier figures are as published on **2026-09-17** and can change; re-check vendor
  pricing pages before relying on them.

---

## Sources

Primary sources, fetched 2026-09-17:

**Clerk**
- Pricing: https://clerk.com/pricing
- Next.js quickstart: https://clerk.com/docs/quickstarts/nextjs
- Users (create/delete, bulk-delete limitation): https://clerk.com/docs/users/overview
- Session tokens (JWT cookie, `sub`): https://clerk.com/docs/backend-requests/resources/session-tokens
- Syncing extra user data to your DB: https://clerk.com/docs/guides/development/webhooks/syncing
- Deploy to production / instances: https://clerk.com/docs/deployments/overview
- Migrating (export incl. hashed passwords): https://clerk.com/docs/deployments/migrate-overview
- Deploy to Vercel / preview envs: https://clerk.com/docs/guides/development/deployment/vercel
- Managing environments (preview approaches): https://clerk.com/docs/guides/development/managing-environments

**Auth.js / NextAuth**
- Homepage (now part of Better Auth): https://authjs.dev/
- Getting started (auth methods, adapters, migrate to Better Auth): https://authjs.dev/getting-started

**Better Auth**
- Introduction (self-hosted framework): https://www.better-auth.com/docs/introduction
- Database (core schema, adapters, CLI): https://www.better-auth.com/docs/concepts/database
- Session management: https://www.better-auth.com/docs/concepts/session-management
- Email & password: https://www.better-auth.com/docs/authentication/email-password
- Magic link plugin: https://www.better-auth.com/docs/plugins/magic-link
- Pricing / Infrastructure: https://www.better-auth.com/pricing

**Supabase**
- Pricing (MAU, pausing, email rate): https://supabase.com/pricing
- SSR / Next.js (`@supabase/ssr`, `getClaims`): https://supabase.com/docs/guides/auth/server-side/nextjs
- Users (`auth.users`, user object): https://supabase.com/docs/guides/auth/users
- Rate limits (2 emails/hour): https://supabase.com/docs/guides/auth/rate-limits
- Local development & CLI: https://supabase.com/docs/guides/local-development

**WorkOS**
- Pricing (1M MAU free, $2,500/1M, custom domain $99): https://workos.com/pricing
- AuthKit overview: https://workos.com/docs/authkit/overview
- Sessions (access + refresh token): https://workos.com/docs/authkit/sessions
- User Management sessions: https://workos.com/docs/user-management/sessions
- Users and Organizations: https://workos.com/docs/organizations
- Custom domains: https://workos.com/docs/custom-domains
- AuthKit domain (staging default, production custom): https://workos.com/docs/custom-domains/authkit
- Events API "sync users to your DB": https://workos.com/user-management
- Webhooks reference (`user.created`): https://workos.com/docs/reference/webhooks

**Descope**
- Pricing (7,500 MAU free, limits, $249 Pro): https://www.descope.com/pricing
- User management (immutable userId, store): https://docs.descope.com/management/user-management
- User Management API (delete + batch delete, create/update): https://docs.descope.com/api/management/users
- User exporting (Search Users API / CSV; hashes via support): https://docs.descope.com/management/user-management/user-exporting
- Sessions (session + refresh JWT; HttpOnly cookie): https://docs.descope.com/sessions/management
- Backend SDK user ops: https://docs.descope.com/management/user-management/sdks

**Added candidates**
- Firebase pricing (50K MAU no-cost, phone billed): https://firebase.google.com/pricing
- Auth0 pricing (25K MAU free, $35/mo B2C): https://auth0.com/pricing
