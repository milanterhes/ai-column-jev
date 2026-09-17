import { useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { SiteHeader } from "../components/site-header.tsx"
import { UploadDialog } from "../components/upload-dialog.tsx"
import { Button } from "../../components/ui/button.tsx"
import { api } from "../api/client.ts"
import { useSession } from "../auth/use-session.ts"

export const Route = createFileRoute("/")({
  component: LandingPage
})

const EXAMPLE_COLUMNS = ["Company", "Description", "B2B SaaS?", "ICP Fit?"]

const EXAMPLE_ROWS = [
  {
    company: "Northwind Analytics",
    description: "Cloud BI for enterprise finance teams",
    b2b: "Yes",
    b2bConfidence: "98%",
    icp: "Yes",
    icpConfidence: "91%",
    review: false
  },
  {
    company: "PixelPop",
    description: "Consumer photo filters for iOS",
    b2b: "No",
    b2bConfidence: "97%",
    icp: "No",
    icpConfidence: "94%",
    review: false
  },
  {
    company: "Ledgerly",
    description: "Bookkeeping tools for independent consultants",
    b2b: "Yes",
    b2bConfidence: "88%",
    icp: "Yes",
    icpConfidence: "83%",
    review: false
  },
  {
    company: "Harbor Studio",
    description: "Design agency for healthcare brands",
    b2b: "Yes",
    b2bConfidence: "76%",
    icp: "No",
    icpConfidence: "81%",
    review: true
  }
]

const PILLARS = [
  ["No workflow builder", "You write a question. There is no canvas, no nodes, no orchestration to learn."],
  ["No coding", "Upload a CSV, add a column, and the judgment runs over every row."],
  ["Structured answers", "Every result is one of the column's labels, so it sorts, filters and exports."],
  ["Confidence-aware", "Each cell carries the model's confidence, and uncertain rows are waiting in a review queue."],
  ["Export when done", "The finished sheet leaves as a plain CSV, with original columns untouched."]
]

function LandingPage() {
  const { data: session } = useSession()
  const navigate = useNavigate()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [creatingDemo, setCreatingDemo] = useState(false)

  const signedIn = session !== null && session !== undefined

  const openUpload = async () => {
    if (!signedIn) {
      await navigate({ to: "/signin" })
      return
    }
    setUploadOpen(true)
  }

  const trySample = async () => {
    if (!signedIn) {
      await navigate({ to: "/signin" })
      return
    }
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
      <main className="mx-auto max-w-5xl px-6">
        <section className="border-b border-border py-16">
          <h1 className="max-w-3xl font-heading text-4xl leading-tight font-semibold tracking-tight">
            Add columns to your spreadsheet that require human judgment.
          </h1>
          <p className="mt-5 max-w-2xl text-sm text-muted-foreground">
            Upload a CSV. Describe the column you wish you had. Get a structured, confident answer
            for every row — and review the ones the model was unsure about. No workflow builder, no
            code, no chat.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={openUpload}>
              Upload CSV
            </Button>
            <Button size="lg" variant="outline" onClick={trySample} disabled={creatingDemo}>
              {creatingDemo ? "Creating…" : "Try it with sample data"}
            </Button>
            {!signedIn ? (
              <Link
                to="/signin"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Sign in
              </Link>
            ) : null}
          </div>
        </section>

        <section className="border-b border-border py-12">
          <div className="overflow-x-auto border border-border">
            <table className="w-max min-w-full border-collapse text-xs">
              <thead className="bg-muted">
                <tr>
                  {EXAMPLE_COLUMNS.map((header) => (
                    <th
                      key={header}
                      className="border-b border-r border-border px-3 py-2 text-left font-medium last:border-r-0"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {EXAMPLE_ROWS.map((row) => (
                  <tr key={row.company} className="border-b border-border last:border-b-0">
                    <td className="border-r border-border px-3 py-2 whitespace-nowrap">
                      {row.company}
                    </td>
                    <td className="max-w-72 truncate border-r border-border px-3 py-2">
                      {row.description}
                    </td>
                    <td className="border-r border-border bg-primary/5 px-3 py-2 whitespace-nowrap">
                      <span>{row.b2b}</span>
                      <span className="ml-2 text-muted-foreground">{row.b2bConfidence}</span>
                      {row.review ? <span className="ml-1 text-amber-600">⚠</span> : null}
                    </td>
                    <td className="bg-primary/5 px-3 py-2 whitespace-nowrap">
                      <span>{row.icp}</span>
                      <span className="ml-2 text-muted-foreground">{row.icpConfidence}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Confidence is the model's own certainty. It is a relative, thresholded signal — higher
            is more reliable, and below the threshold the row is sent to review.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-x-10 gap-y-8 py-12 sm:grid-cols-2">
          {PILLARS.map(([title, body]) => (
            <div key={title} className="border-l border-border pl-4">
              <h2 className="font-heading text-sm font-medium">{title}</h2>
              <p className="mt-1.5 text-xs text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
      </main>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  )
}
