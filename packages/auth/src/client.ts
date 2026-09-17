import { emailOTPClient, organizationClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

/**
 * The browser-side auth client.
 *
 * `createAuthClient`'s inferred type is not nameable from another package (it
 * references deep paths inside better-auth and zod), so the surface we use is
 * declared explicitly and the client assigned to it. The assignment is
 * type-checked — if better-auth's signatures drift, this stops compiling.
 *
 * Browser-only: never import this from a server process, or `pg` and the
 * server config come with it.
 */

export interface AuthCallResult<T> {
  readonly data: T | null
  readonly error: { readonly message?: string | undefined; readonly code?: string | undefined } | null
}

export interface SessionShape {
  readonly user: { readonly id: string; readonly email: string; readonly emailVerified: boolean }
}

export interface AuthClient {
  readonly signIn: {
    readonly emailOtp: (input: {
      readonly email: string
      readonly otp: string
    }) => Promise<AuthCallResult<SessionShape>>
    readonly social: (input: {
      readonly provider: string
      readonly callbackURL?: string | undefined
    }) => Promise<AuthCallResult<unknown>>
  }
  readonly emailOtp: {
    readonly sendVerificationOtp: (input: {
      readonly email: string
      readonly type: "change-email" | "email-verification" | "forget-password" | "sign-in"
    }) => Promise<AuthCallResult<unknown>>
  }
  readonly getSession: () => Promise<AuthCallResult<SessionShape>>
  readonly signOut: () => Promise<unknown>
}

const raw = createAuthClient({
  baseURL: typeof window === "undefined" ? "http://localhost:3000" : window.location.origin,
  plugins: [organizationClient(), emailOTPClient()]
})

export const authClient: AuthClient = raw
