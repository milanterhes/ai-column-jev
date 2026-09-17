import { betterAuth, type Auth, type BetterAuthOptions } from "better-auth"
import { emailOTP, organization } from "better-auth/plugins"
import { Context } from "effect"
import { Pool } from "pg"

export type OtpType = "sign-in" | "email-verification" | "forget-password" | "change-email"

export interface AuthProviderConfig {
  readonly clientId: string
  readonly clientSecret: string
}

export interface AuthConfig {
  readonly database: Pool
  readonly secret: string
  readonly baseURL?: string | undefined
  readonly google?: AuthProviderConfig | undefined
  readonly sendVerificationOTP?:
    | ((data: { readonly email: string; readonly otp: string; readonly type: OtpType }) => Promise<void>)
    | undefined
}

const defaultSendVerificationOTP = async (data: {
  readonly email: string
  readonly otp: string
  readonly type: OtpType
}): Promise<void> => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("AuthConfig.sendVerificationOTP is required in production")
  }
  console.log(`[auth] ${data.type} verification code for ${data.email}: ${data.otp}`)
}

const socialProviders = (config: AuthConfig): BetterAuthOptions["socialProviders"] =>
  config.google === undefined ? undefined : { google: config.google }

export const authOptions = (config: AuthConfig, database: Pool = config.database): BetterAuthOptions => ({
  database,
  secret: config.secret,
  baseURL: config.baseURL,
  socialProviders: socialProviders(config),
  plugins: [
    organization(),
    emailOTP({
      sendVerificationOTP: async (data) => {
        await (config.sendVerificationOTP ?? defaultSendVerificationOTP)(data)
      }
    })
  ]
})

export type AuthInstance = Auth<BetterAuthOptions>

export const createAuth = (config: AuthConfig): AuthInstance => betterAuth(authOptions(config))

export class AuthService extends Context.Service<AuthService, AuthInstance>()("app/auth/AuthService") {}
