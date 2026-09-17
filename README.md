# Scaffold

A production-shaped starter for a full-stack TypeScript app: session-based
authentication, a Postgres-backed domain, and object storage — wired together,
tested, and ready to copy. Everything is **Effect-first**: the API, the auth
protocol, the database layer, and the tests are built on
[Effect](https://effect.website/) 4. The front end is TanStack Start + React +
shadcn, consuming a typed client generated from the same `HttpApi` contract the
server implements.

- **Auth that works out of the box** — email-code sign-in (codes print to the
  terminal until you add Resend), Google/LinkedIn/GitHub OAuth, HttpOnly
  sessions with sliding expiry, and account linking. No provider required to
  try it.
- **A complete vertical slice to copy** — the `notes` package is the template:
  schema → Postgres repo → `HttpApi` group → impl → typed client → React page →
  tests.
- **Object storage done honestly** — the `documents` package uploads through
  S3-compatible storage (AWS S3 in production, Garage locally) via presigned
  URLs; a confirm endpoint HEAD-verifies the object before the row flips
  `pending → stored`.
- **Real infra conventions** — Postgres via Docker, Effect migrations, a
  dedicated test database, Turbo-driven dev/test/lint/build across the monorepo.

## Quick start

```bash
# 1. Install and start infra (Postgres + Garage object storage)
pnpm install
docker compose up -d

# 2. Configure env (defaults already point at the Docker services)
cp .env.example .env

# 3. Migrate, configure object-storage CORS, and run
pnpm migrate
pnpm setup:object-storage      # idempotent; only the browser upload path needs it
pnpm dev                       # http://localhost:3000
```

Sign in with any email and read the code from the server terminal — you're in.
The **My notes** link exercises the full vertical slice; the **Documents** link
runs the upload → presigned PUT → confirm → list/download/delete flow against
Garage.

### Rename it to your project

```bash
cp -R scaffold my-app && cd my-app
# Replace the package scope and app name everywhere they appear, then refresh
# the lockfile.
grep -rIl --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  --exclude-dir=.turbo --exclude=pnpm-lock.yaml -e '@app' -e 'scaffold' -e 'Scaffold' . \
  | xargs sed -i '' -e 's/@app/YOUR_SCOPE/g' -e 's/scaffold/my-app/g' -e 's/Scaffold/My App/g'
rm -rf pnpm-lock.yaml node_modules && pnpm install
```

Three tokens cover every reference: `@app` (package scope / imports),
`scaffold` (repo name, Postgres database, model identifier, logger prefix), and
`Scaffold` (display name in headings and `<title>`).

## Repository layout

```
apps/
  web/                 TanStack Start SPA; the Effect HttpApi is mounted at
                       /api/* inside the same server process.
    src/api/           HttpApi groups (notes, documents), auth wiring, typed clients
    src/routes/        __root, index, signin, notes, documents, api/$ (the API splat)
    components/        shadcn components + the effect-machine uploader
packages/
  auth/                The auth core — pure Effect, no DB/email/HTTP deps:
                       email-code + OAuth protocol, sessions, linking, privacy.
                       Defines the AuthStorage and Mailer seams.
  auth-postgres/       Postgres AuthStorage + OAuthPendingStore, its own schema
                       (auth.*) and migrations.
  auth-resend/         Resend mailer. Falls back to a logger mailer with no key.
  core/                Shared Postgres client (PgLive) + test-database helpers.
  notes/               Demo domain: Model, migration, repo, schema, tests.
  documents/           Demo object-storage domain: Model, migration, repo, a
                       `Storage` seam over S3/Garage (presign, head, delete),
                       schema, tests.
scripts/
  migrate.ts           Applies app migrations, then the auth schema migrations.
  setup-object-storage.ts  Configures CORS on the local Garage bucket.
```

The `apps/web` app composes the auth, notes, and documents `HttpApi` groups into
one `WebApi` and mounts it at `/api/*` via a TanStack Start server route
(`src/routes/api/$.ts`). All packages share one `tsconfig.base.json`
(`strict`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`) and one pnpm
version catalog.

## Authentication

`packages/auth` is deliberately dependency-free. The three external concerns are
interfaces you provide at the app's composition root
(`apps/web/src/api/auth.live.ts`):

| Seam | Default implementation | Swap for |
| --- | --- | --- |
| `AuthStorage` | Postgres (`auth-postgres`) | In-memory for tests |
| `Mailer` | Resend (`auth-resend`) | Logger mailer (no key) |
| `OAuthPendingStore` | Postgres (`auth-postgres`) | In-memory for tests |

Everything that needs a user is behind `SessionMiddleware`; missing, invalid, or
expired sessions return `401`, and a rotated token is re-issued on the response
automatically. OAuth providers only appear on the sign-in page when their env
vars are set. Enable any provider by adding its credentials to `.env` — see the
[provider notes](#oauth-providers) below.

The auth group is served under `/api/auth/*`:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/email-code` | Request a sign-in code (rate-limited) |
| `POST` | `/auth/email-code/verify` | Redeem a code, set the session cookie |
| `GET` | `/auth/oauth/:provider/start` | Begin an OAuth flow (PKCE + state) |
| `GET` | `/auth/oauth/:provider/callback` | Exchange the code, link, set the cookie |
| `POST` | `/auth/signout` | Clear the session cookie, invalidate server-side |
| `GET` | `/auth/me` | The current user (session required) |
| `DELETE` | `/auth/me` | Delete the account and all auth data |

### Branding the sign-in email

The sign-in-code email copy (from address, subject, body) is not hardcoded
anywhere. The `Mailer` implementations render an `EmailCodeTemplate` service
supplied by your app; `DefaultEmailCodeTemplate` provides a neutral fallback
(`no-reply@example.com` / "Your sign-in code"). Brand it at the composition
root:

```ts
import { EmailCodeTemplate } from "@app/auth"

export const AppEmailCodeTemplate = Layer.succeed(EmailCodeTemplate, {
  from: "Acme <no-reply@acme.com>",
  subject: "Your Acme sign-in code",
  text: (code) => `Your Acme sign-in code is ${code}.`
})
```

Provide it alongside the auth layers (e.g.
`Layer.provideMerge(AppEmailCodeTemplate)` where `AuthLive` is assembled). The
Resend mailer sends exactly this copy; the logger mailer prints it to the
terminal, so local development shows the same message your users receive.

## Adding your first feature

The `notes` package is the template — copy its shape. A new feature is a
vertical slice across a domain package and the web app:

1. **Domain package** — `packages/<feature>/`
   - `src/db/models.ts` — a `Model.Class` for your table (branded id, typed
     columns).
   - `src/db/migrations.ts` — the migration, as an Effect program, merged into
     the migrator by `scripts/migrate.ts`.
   - `src/repo/*.repo.ts` — `Effect.fnUntraced` functions talking to Postgres
     through `SqlClient` (no ORM).
   - `src/schema/api.ts` — the API wire schemas.
   - Tests alongside: `src/repo/*.repo.test.ts` using the shared test DB.
2. **HTTP group** — `apps/web/src/api/<feature>.api.ts` declares endpoints
   (guarded by `SessionMiddleware`), `<feature>.impl.ts` implements them with
   `HttpApiBuilder.group`, and `<feature>.ts` is the typed client.
3. **Route + page** — `apps/web/src/routes/<feature>.tsx` using the typed client
   and the shadcn components.
4. **API test** — `apps/web/src/api/<feature>.api.test.ts` builds the composed
   router, signs in through the real flow, and asserts on the endpoints.

Wire the group into `apps/web/src/api/web.api.ts` (one `addHttpApi` line), the
impl into `mount.ts` (one `Layer.mergeAll` entry), and register any package
migrations in `scripts/migrate.ts`.

For docs that point at object storage, see `packages/documents` instead: a
`Storage` seam (`Context.Service`) with an S3 backend under
`src/storage/s3.ts` and an in-memory double under `src/storage/test.ts`. The
`HttpApi` group presigns PUT/GET URLs and the confirm endpoint HEAD-verifies the
object against the row before flipping `pending → stored`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the web app (Turbo, `:3000`) |
| `pnpm build` | Type-check and build every package |
| `pnpm test` | Run every package's Vitest suite |
| `pnpm lint` | `tsc --noEmit` across the repo |
| `pnpm migrate` | Apply app migrations, then the auth-schema migrations |
| `pnpm setup:object-storage` | Configure CORS on the local Garage bucket (idempotent) |
| `pnpm --filter <pkg> <task>` | Target a single package |

## Testing

Vitest runs in every package. DB-backed tests use a dedicated `scaffold_test`
database, created on demand and migrated in `beforeAll`
(`packages/core/src/test-utils.ts` exports `setupTestDb` and `TestDbLayer`).

The web API tests exercise the **real composed router** through a fetch-style
bridge — sign-in via the actual email-code flow, then assertions against the
session-protected endpoints. This mirrors the auth package's own test harness
(`packages/auth/src/httpapi.test.ts`), which uses an in-memory `AuthStorage` and
a fake OAuth HTTP client to keep the auth suite fast and hermetic.

The documents API test drives the full upload flow against an in-memory
`Storage` double; the real S3/Garage integration is covered by
`packages/documents/src/storage/s3.storage.test.ts`, a round-trip test that
presigns a PUT, uploads raw bytes, heads them, presigns a GET, and deletes. It
runs when `STORAGE_*` env vars are set (Garage via `docker compose up -d`) and
skips otherwise.

## Environment variables

See `.env.example` for the full template.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection (Docker defaults work) |
| `RESEND_API_KEY` | no | Email delivery; unset → codes print to terminal |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | no | Enable Google OAuth |
| `LINKEDIN_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | no | Enable LinkedIn OAuth |
| `GITHUB_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | no | Enable GitHub OAuth |
| `GITHUB_USER_AGENT` | no | User-Agent for GitHub's API (recommended) |
| `STORAGE_ENDPOINT` | docs only | S3-compatible endpoint; Garage by default (`http://localhost:3900`) |
| `STORAGE_REGION` | docs only | Region sent to the store (`garage` for Garage) |
| `STORAGE_BUCKET` | docs only | Bucket name (`scaffold-documents`) |
| `STORAGE_ACCESS_KEY_ID` | docs only | Access key for the bucket |
| `STORAGE_SECRET_ACCESS_KEY` | docs only | Secret for the bucket |
| `STORAGE_FORCE_PATH_STYLE` | docs only | `true` for Garage/MinIO, `false` for AWS S3 |
| `MAX_DOCUMENT_SIZE_BYTES` | no | Document upload limit in bytes (default 5 GiB, S3's single-PUT ceiling). Larger values need multipart uploads |

`STORAGE_*` are required only when the documents group is exercised (the storage
layer fails at startup if they are absent). The `.env.example` / `docker-compose`
values match the locally provisioned Garage bucket. In production, point the
same vars at AWS S3 and set `STORAGE_FORCE_PATH_STYLE=false`.

## OAuth providers

Enable any provider by adding its credentials to `.env`. The redirect URIs
(`http://localhost:3000/api/auth/oauth/<provider>/callback`) must be registered
with the provider.

| Provider | Env prefix | Notes |
| --- | --- | --- |
| Google | `GOOGLE_` | OIDC |
| LinkedIn | `LINKEDIN_` | OIDC |
| GitHub | `GITHUB_` | OAuth2; set `GITHUB_USER_AGENT` too (GitHub rejects the default) |

## Docs & conventions

- **Architecture decisions** live in
  [`docs/architecture-decisions.md`](docs/architecture-decisions.md) (ADRs in
  one file) — read the sections touching the area you're about to work in.
- **Repository guidelines** for agents (and humans) are in
  [`AGENTS.md`](AGENTS.md): Effect patterns, build/test/run commands, and the
  agent-skill framework under `.agents/skills/`.
- **Postgres is the source of truth** — raw SQL through Effect's Postgres layer,
  no ORM. Migrations are Effect programs.
- **Packages own their schema** — the auth package keeps its own `auth` schema
  and journal, separate from application migrations, so it can be reused or
  upgraded independently.
- **The `HttpApi` contract is the single source of truth** — the server
  implements it, the client is generated from it, and the tests exercise the
  composed router through it.
- **No comments unless they carry information the code does not.**

## License

This is a scaffold for you to build on — copy it, rename it, and make it yours.
No license file is shipped; choose one that fits your project if you publish
it.
