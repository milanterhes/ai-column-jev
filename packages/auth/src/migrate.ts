import { getMigrations } from "better-auth/db/migration"
import { Effect } from "effect"
import { authOptions, type AuthConfig } from "./server.ts"

export const migrationsTable = "better_auth_migrations"

const applyAuthMigrations = async (config: AuthConfig): Promise<void> => {
  const pool = config.database
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${migrationsTable} (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
  )
  const { runMigrations } = await getMigrations(authOptions(config, pool))
  await runMigrations()
  await pool.query(
    `INSERT INTO ${migrationsTable} (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
    ["better-auth"]
  )
}

export const runAuthMigrations = (config: AuthConfig): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: () => applyAuthMigrations(config),
    catch: (error) => (error instanceof Error ? error : new Error(String(error)))
  })
