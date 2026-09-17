import { Effect, Layer, Option, Redacted } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiError } from "effect/unstable/httpapi"
import { CurrentUser, SESSION_COOKIE_NAME, SessionMiddleware } from "./api.ts"
import { AuthService } from "./server.ts"

const cookieHeader = (request: Option.Option<HttpServerRequest.HttpServerRequest>, credential: string): string =>
  Option.isSome(request)
    ? Object.entries(request.value.cookies).map(([name, value]) => `${name}=${value}`).join("; ")
    : `${SESSION_COOKIE_NAME}=${credential}`

export const SessionMiddlewareLive: Layer.Layer<SessionMiddleware, never, AuthService> = Layer.succeed(
  SessionMiddleware,
  {
    sessionCookie: (httpEffect, options) =>
      Effect.gen(function*() {
        const auth = yield* AuthService
        const request = yield* Effect.serviceOption(HttpServerRequest.HttpServerRequest)
        const cookie = cookieHeader(request, Redacted.value(options.credential))
        const session = yield* Effect.promise(() =>
          auth.api.getSession({ headers: new Headers({ cookie }) })
        )
        if (session === null) {
          return yield* new HttpApiError.Unauthorized({})
        }
        return yield* Effect.provideService(httpEffect, CurrentUser, {
          id: session.user.id,
          email: session.user.email,
          emailVerified: session.user.emailVerified
        })
      })
  }
)
