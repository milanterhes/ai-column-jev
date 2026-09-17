import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Load the gitignored repo-root `.env` into `process.env`, finding the repo
 * root by walking up from this module until a `.env` is found. Robust across
 * dev (source) and build (bundled dist) locations. Same purpose as
 * `apps/worker/src/env.ts`, duplicated here because the web server cannot
 * import from the worker app.
 *
 * The repo `.env` is authoritative: unlike `process.loadEnvFile` (which leaves
 * an already-set variable untouched — e.g. a stale `OPENROUTER_API_KEY`
 * exported in a shell session), this always overwrites.
 */
export const loadEnv = (): void => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    const envFile = join(dir, ".env")
    if (existsSync(envFile)) {
      const content = readFileSync(envFile, "utf8")
      for (const line of content.split("\n")) {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
        if (match === null) continue
        const [, key, value] = match
        process.env[key] = value
      }
      return
    }
    const parent = dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}