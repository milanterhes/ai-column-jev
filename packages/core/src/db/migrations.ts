import { Effect } from "effect"
import { SqlClient, SqlError } from "effect/unstable/sql"

/**
 * The base application migration registry. Domain packages (e.g.
 * `@app/notes`) export their own migration records and the root migration
 * script merges them with this one. Tests use `runTestMigrations` with the
 * same combined registry.
 *
 * Empty today; add the first migration here once the app has a table that
 * isn't owned by a domain package.
 */
export const migrations: Record<string, Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>> = {}
