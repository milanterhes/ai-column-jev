import { authClient } from "@app/auth/client"

export { authClient }

export interface SessionUser {
  id: string
  email?: string | null | undefined
}

export interface Session {
  user: SessionUser
}

interface AuthResult<T> {
  data?: T | null
  error?: { message?: string | undefined } | null
}

const unwrap = <T>(result: AuthResult<T>, fallback: string): T => {
  if (result.error != null) throw new Error(result.error.message ?? fallback)
  return result.data as T
}

export const getSession = async (): Promise<Session | null> => {
  const result = (await authClient.getSession()) as AuthResult<Session>
  return result.data ?? null
}

export const sendSignInCode = async (email: string): Promise<void> => {
  unwrap(await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" }), "Could not send the code")
}

export const signInWithCode = async (email: string, otp: string): Promise<void> => {
  unwrap(await authClient.signIn.emailOtp({ email, otp }), "That code was not accepted")
}

export const signOut = async (): Promise<void> => {
  await authClient.signOut()
}
