import { Link, useNavigate } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "../../components/ui/button.tsx"
import { signOut } from "../auth/client.ts"
import { sessionQueryKey, useSession } from "../auth/use-session.ts"

export function SiteHeader() {
  const { data: session } = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const handleSignOut = async () => {
    await signOut()
    queryClient.setQueryData(sessionQueryKey, null)
    await navigate({ to: "/" })
  }

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-5">
        <Link to="/" className="font-heading text-sm font-semibold tracking-tight">
          AI Column
        </Link>
        {session !== null && session !== undefined ? (
          <Link
            to="/datasets"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Datasets
          </Link>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        {session?.user !== undefined && session?.user !== null ? (
          <>
            <span className="text-xs text-muted-foreground">{session.user.email}</span>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" render={<Link to="/signin" />} nativeButton={false}>
            Sign in
          </Button>
        )}
      </div>
    </header>
  )
}
