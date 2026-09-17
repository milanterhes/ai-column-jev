import { existsSync } from "node:fs"
import { PgClient, PgMigrator } from "@effect/sql-pg"
import { NodeChildProcessSpawner, NodeFileSystem, NodePath, NodeRuntime } from "@effect/platform-node"
import { runAuthMigrations } from "@app/auth/migrate"
import { migrations } from "@app/core"
import { spreadsheetMigrations } from "@app/spreadsheet/server"
import { Config, Effect, Layer } from "effect"
import { Pool } from "pg"

if (existsSync(".env")) {
  process.loadEnvFile(".env")
}

const databaseUrl = process.env["DATABASE_URL"] ?? ""

const SqlClientLayer = PgClient.layerConfig({ url: Config.redacted("DATABASE_URL") })

const MigratorLayer = PgMigrator.layer({
  loader: PgMigrator.fromRecord({ ...migrations, ...spreadsheetMigrations })
})

const SqlLive = MigratorLayer.pipe(Layer.provideMerge(SqlClientLayer))

const Live = SqlLive.pipe(
  Layer.provideMerge(NodeChildProcessSpawner.layer),
  Layer.provideMerge(NodeFileSystem.layer),
  Layer.provideMerge(NodePath.layer)
)

/**
 * Auth tables first.
 *
 * better-auth owns `user` and `session`; any table of ours that references them
 * must migrate after. This inverts the order inherited from `~/code/platform`,
 * where auth migrations run last — see the decision
 * "Dataset privacy and lifecycle".
 */
const program = Effect.gen(function*() {
  const pool = new Pool({ connectionString: databaseUrl })
  const baseURL = process.env["BETTER_AUTH_URL"]

  yield* runAuthMigrations({
    database: pool,
    secret: process.env["BETTER_AUTH_SECRET"] ?? "development-only-secret-change-me",
    baseURL
  })
  yield* Effect.log("Auth migrations applied")

  yield* Effect.promise(() => pool.end())
  yield* Effect.log("Application migrations applied")
})

NodeRuntime.runMain(program.pipe(Effect.provide(Live)))
