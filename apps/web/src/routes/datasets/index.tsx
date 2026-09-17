import { useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { SiteHeader } from "../../components/site-header.tsx"
import { UploadDialog } from "../../components/upload-dialog.tsx"
import { Button } from "../../../components/ui/button.tsx"
import { api } from "../../api/client.ts"
import { useDatasets } from "../../api/hooks.ts"
import { useSession } from "../../auth/use-session.ts"

export const Route = createFileRoute("/datasets/")({
  component: DatasetsPage
})

function DatasetsPage() {
  const { data: session, isPending: sessionPending } = useSession()
  const signedIn = session !== null && session !== undefined
  const { data: datasets, isPending, error } = useDatasets(signedIn)
  const navigate = useNavigate()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [creatingDemo, setCreatingDemo] = useState(false)

  const trySample = async () => {
    setCreatingDemo(true)
    try {
      const dataset = await api.createDemo()
      await navigate({ to: "/datasets/$datasetId", params: { datasetId: dataset.id } })
    } finally {
      setCreatingDemo(false)
    }
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <h1 className="font-heading text-lg font-semibold tracking-tight">Datasets</h1>
          {signedIn ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={trySample} disabled={creatingDemo}>
                {creatingDemo ? "Creating…" : "Try it with sample data"}
              </Button>
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                Upload CSV
              </Button>
            </div>
          ) : null}
        </div>

        {sessionPending ? (
          <p className="py-10 text-xs text-muted-foreground">Loading…</p>
        ) : !signedIn ? (
          <div className="py-16 text-center">
            <p className="text-sm">Sign in to upload a spreadsheet.</p>
            <Button className="mt-4" render={<Link to="/signin" />} nativeButton={false}>
              Sign in
            </Button>
          </div>
        ) : isPending ? (
          <p className="py-10 text-xs text-muted-foreground">Loading…</p>
        ) : error !== null ? (
          <p className="py-10 text-xs text-destructive">
            {error instanceof Error ? error.message : "Could not load datasets."}
          </p>
        ) : datasets === undefined || datasets.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm">No datasets yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload a CSV or open the sample dataset to see how this works.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="outline" onClick={trySample} disabled={creatingDemo}>
                Try it with sample data
              </Button>
              <Button onClick={() => setUploadOpen(true)}>Upload CSV</Button>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {datasets.map((dataset) => (
              <li key={dataset.id}>
                <Link
                  to="/datasets/$datasetId"
                  params={{ datasetId: dataset.id }}
                  className="flex items-center justify-between gap-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{dataset.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{dataset.filename}</p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    <p>
                      {dataset.rowCount.toLocaleString()} rows · {dataset.columnCount} columns
                    </p>
                    <p>{new Date(dataset.createdAt).toLocaleDateString()}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  )
}
