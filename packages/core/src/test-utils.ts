import { PgClient, PgMigrator } from "@effect/sql-pg"
import {
  NodeChildProcessSpawner,
  NodeFileSystem,
  NodePath
} from "@effect/platform-node"
import { Effect, Layer, Redacted } from "effect"
import { Migrator, SqlClient, SqlError } from "effect/unstable/sql"

export const TEST_DB_NAME = "scaffold_test"
export const TEST_DB_URL = `postgres://postgres:postgres@localhost:5432/${TEST_DB_NAME}`
const ADMIN_DB_URL = "postgres://postgres:postgres@localhost:5432/postgres"

/** Create the dedicated test database if it does not exist yet. */
export const ensureTestDb: Effect.Effect<void, SqlError.SqlError> = Effect.gen(function*() {
  const admin = yield* SqlClient.SqlClient
  const rows = yield* admin<{ readonly count: number }>`
    SELECT count(*)::int AS count FROM pg_database WHERE datname = 'scaffold_test'
  `
  if (rows[0].count === 0) {
    yield* admin`CREATE DATABASE scaffold_test`
  }
}).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(ADMIN_DB_URL) })))

/**
 * Apply a migration registry to the test database. Call this (alongside
 * `ensureTestDb`) from a test's `beforeAll`; `setupTestDb` below bundles both.
 */
export const runTestMigrations = (
  migrations: Record<string, Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>>
): Effect.Effect<
  ReadonlyArray<readonly [number, string]>,
  Migrator.MigrationError | SqlError.SqlError
> =>
  PgMigrator.run({ loader: PgMigrator.fromRecord(migrations) }).pipe(
    Effect.provide(NodeChildProcessSpawner.layer),
    Effect.provide(NodeFileSystem.layer),
    Effect.provide(NodePath.layer),
    Effect.provide(PgClient.layer({ url: Redacted.make(TEST_DB_URL) }))
  )

/**
 * Provides `SqlClient` against the test database. Construction is synchronous
 * (pool creation is lazy), so it is safe to share via `@effect/vitest`'s
 * `layer()` helper.
 */
export const TestDbLayer: Layer.Layer<
  SqlClient.SqlClient | PgClient.PgClient,
  SqlError.SqlError,
  never
> = PgClient.layer({ url: Redacted.make(TEST_DB_URL) })

/**
 * Create the test database and apply the given migrations. Returns an Effect
 * to run from `beforeAll`. Pass the combined app + domain migrations; for
 * tests that touch auth, additionally run `runAuthMigrations` from
 * `@app/auth-postgres` against `TestDbLayer`.
 */
export const setupTestDb = (
  migrations: Record<string, Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>>
): Effect.Effect<void, Migrator.MigrationError | SqlError.SqlError> =>
  Effect.gen(function*() {
    yield* ensureTestDb
    yield* runTestMigrations(migrations)
  })
