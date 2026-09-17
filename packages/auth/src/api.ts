import { Context } from "effect"
import { HttpApiError, HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi"
import type { AuthService } from "./server.ts"

export const SESSION_COOKIE_NAME = "better-auth.session_token"

export class CurrentUser extends Context.Service<CurrentUser, {
  readonly id: string
  readonly email: string
  readonly emailVerified: boolean
}>()("app/auth/CurrentUser") {}

export const sessionCookieSecurity: HttpApiSecurity.ApiKey = HttpApiSecurity.apiKey({
  in: "cookie",
  key: SESSION_COOKIE_NAME
})

export class SessionMiddleware extends HttpApiMiddleware.Service<SessionMiddleware, {
  readonly requires: AuthService
  readonly provides: CurrentUser
}>()("app/auth/SessionMiddleware", {
  error: HttpApiError.Unauthorized,
  security: { sessionCookie: sessionCookieSecurity }
}) {}
