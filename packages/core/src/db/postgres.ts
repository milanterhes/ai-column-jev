import { PgClient } from "@effect/sql-pg"
import { Config } from "effect"

/**
 * The shared Postgres client layer, configured from the `DATABASE_URL`
 * environment variable. Provided once at the app's composition root
 * (`apps/web/src/api/mount.ts` and the migration script).
 */
export const PgLive = PgClient.layerConfig({ url: Config.redacted("DATABASE_URL") })
