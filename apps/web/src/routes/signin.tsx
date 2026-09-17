import { useEffect, useState, type FormEvent } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { SiteHeader } from "../components/site-header.tsx"
import { Button } from "../../components/ui/button.tsx"
import { Input } from "../../components/ui/input.tsx"
import { sendSignInCode, signInWithCode } from "../auth/client.ts"
import { sessionQueryKey, useSession } from "../auth/use-session.ts"

export const Route = createFileRoute("/signin")({
  component: SignInPage
})

function SignInPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [step, setStep] = useState<"email" | "code">("email")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (session !== null && session !== undefined) {
      void navigate({ to: "/datasets" })
    }
  }, [session, navigate])

  const requestCode = async (event: FormEvent) => {
    event.preventDefault()
    if (email.trim() === "") return
    setBusy(true)
    setError(null)
    try {
      await sendSignInCode(email.trim())
      setStep("code")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the code.")
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (event: FormEvent) => {
    event.preventDefault()
    if (code.trim() === "") return
    setBusy(true)
    setError(null)
    try {
      await signInWithCode(email.trim(), code.trim())
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey })
      await navigate({ to: "/datasets" })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That code was not accepted.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-sm px-6 py-20">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          {step === "email"
            ? "We will email you a short code. No password."
            : `Enter the code sent to ${email}.`}
        </p>

        {step === "email" ? (
          <form onSubmit={requestCode} className="mt-6 flex flex-col gap-3">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              required
            />
            <Button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send code"}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="mt-6 flex flex-col gap-3">
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
            <Button type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              onClick={() => {
                setStep("email")
                setCode("")
                setError(null)
              }}
            >
              Use a different email
            </button>
          </form>
        )}

        {error !== null ? (
          <p className="mt-4 border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </main>
    </div>
  )
}
