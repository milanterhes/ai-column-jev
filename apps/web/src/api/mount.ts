import { NodeHttpClient } from "@effect/platform-node"
import { PgLive } from "@app/core"
import { createAuth } from "@app/auth/server"
import { EvaluationServiceLive, JevConfig } from "@app/evaluate"
import { PersistedQueueFactoryLive, PersistedQueueStoreLive } from "@app/queue"
import { Layer, ManagedRuntime } from "effect"
import { Pool } from "pg"
import { loadEnv } from "./env"
import { handleApi } from "./routes"

loadEnv()

/**
 * The composition root: the auth instance, the Postgres client, and the
 * evaluation service, built once at startup and shared by every request.
 */

export const authPool = new Pool({ connectionString: process.env["DATABASE_URL"] })

export const auth = createAuth({
  database: authPool,
  secret: process.env["BETTER_AUTH_SECRET"] ?? "development-only-secret-change-me",
  baseURL: process.env["BETTER_AUTH_URL"],
  sendVerificationOTP: async ({ email, otp }) => {
    // Development: the code goes to the terminal. Swap for a mailer in
    // production — see the spec's base section.
    console.log(`[auth] sign-in code for ${email}: ${otp}`)
  }
})

const JevConfigLive = Layer.succeed(JevConfig, {
  apiKey: process.env["JEV_KEY"] ?? "",
  baseUrl: process.env["JEV_BASE_URL"] ?? "https://api.typesafe.ai",
  model: process.env["JEV_MODEL"] ?? "jev-latest"
})

const EvalLive = EvaluationServiceLive.pipe(
  Layer.provide(Layer.mergeAll(JevConfigLive, NodeHttpClient.layerUndici))
)

// Enqueuing needs the queue's own layers, sitting on the same Postgres client
// the rest of the app uses.
const QueueLive = PersistedQueueFactoryLive.pipe(Layer.provide(PersistedQueueStoreLive))

const ApiLive = Layer.mergeAll(EvalLive, QueueLive).pipe(
  Layer.provideMerge(PgLive)
) as unknown as Layer.Layer<never, never, never>

export const apiRuntime = ManagedRuntime.make(ApiLive)

const SESSION_COOKIE = "better-auth.session_token"

const cookieValue = (request: Request, name: string): string | undefined => {
  const header = request.headers.get("cookie")
  if (header === null) return undefined
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return rest.join("=")
  }
  return undefined
}

/**
 * TanStack Start matches `/api/*`; better-auth owns `/api/auth/*` and takes the
 * request untouched, because it does its own routing and cookie handling.
 * Everything else is our own API, scoped to the signed-in user.
 */
export const apiHandler = async ({ request }: { request: Request }): Promise<Response> => {
  const url = new URL(request.url)

  if (url.pathname === "/api/auth" || url.pathname.startsWith("/api/auth/")) {
    return auth.handler(request)
  }

  const session = await auth.api.getSession({ headers: request.headers })
  if (session === null || session === undefined) {
    return new Response(JSON.stringify({ message: "Sign in to continue." }), {
      status: 401,
      headers: { "content-type": "application/json" }
    })
  }

  const pathname = url.pathname.replace(/^\/api/, "")
  return handleApi(request, apiRuntime as never, session.user.id, pathname)
}

export { SESSION_COOKIE, cookieValue }
