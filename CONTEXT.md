# Scaffold

A pnpm monorepo demonstrating idiomatic Effect 4: a cookie-session email-code auth package, a demo notes domain, and a full-stack web app that mounts an Effect HTTP API inside a TanStack Start server.

## Language

**User**:
A row in the `users` table identified by a `UserId` (branded string). Has an email and `emailVerified` flag. Created on first sign-in.
_Avoid_: account (overloaded with OAuth), profile

**Session**:
A server-side auth session: a random token secret given to the client (as the `session` cookie) and a `tokenHash` (SHA-256 of the secret) stored in the DB. Expires after 30 days, refreshed hourly on active use.
_Avoid_: login, auth token

**Email code**:
A passwordless sign-in code bound to an email address: six digits, `codeHash` (scrypt) stored in the DB, expires in minutes. Verified against the address in the email body — no proof of phone or hardware.
_Avoid_: OTP, magic link (the email contains a code, not a link)

**Sign-in session**:
The transient state between requesting an email code and verifying it (the `signInSessionId` returned by the `/auth/email-code` endpoint). Carries the email and the pending code.
_Avoid_: login session (a verified `Session`, not this)

**OAuth account**:
A link between a `User` and an external identity-provider account (`provider` + `providerAccountId`). A user may link several.
_Avoid_: social login

**Note**:
A row in the `notes` table owned by exactly one `User` (`user_id`). The demo domain for showing the schema/repo/HTTP-API pattern. Lifecycle: create, read, list, update, delete — no soft-delete, no sharing.
_Avoid_: entry, document

**Comparator**:
Nothing here. (Not a crawl project; this is the scaffold's own glossary.)

## Relationships

- `User` 1—N `Session` (a user may have several active sessions)
- `User` 1—N `OAuthAccount` (one per external provider account)
- `User` 1—N `Note`

## Patterns

- **Models**: `packages/notes` defines `Note` via `Model.Class` from `effect/Schema`. `user_id` is `Model.GeneratedByApp(Schema.String)` so clients can't spoof ownership; `created_at`/`updated_at` are `DateTimeInsertFromDate`/`DateTimeUpdateFromDate` so the `select` variant decodes driver `Date`s into `DateTime.Utc`. See ADR-0001.
- **Repos decode**: repo functions return genuine `Note` values by running each driver row through `Schema.decodeUnknownSync(Note)` — never by casting a raw row (`as unknown as Date`) to satisfy a type.
- **HTTP API**: groups defined with `HttpApi`/`HttpApiGroup`, implemented with `HttpApiBuilder.group`. The `SqlClient` requirement shows up as an `HttpRouter.Request<"Requires", SqlClient>` phantom that `Layer.provide` can't strip; satisfied at runtime by `PgLive` (see mount.ts's inline comment and ADR-0001's note on the one sanctioned cast).