import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import { SiteHeader } from "../../components/site-header.tsx"
import { useDataset } from "../../api/hooks.ts"

export const Route = createFileRoute("/datasets/$datasetId")({
  component: DatasetLayout
})

function DatasetLayout() {
  const { datasetId } = Route.useParams()
  const { data: dataset, isPending, error } = useDataset(datasetId)

  return (
    <div className="flex h-screen flex-col">
      <SiteHeader />
      <div className="flex h-11 shrink-0 items-center gap-4 border-b border-border px-4">
        <Link
          to="/datasets"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Datasets
        </Link>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{dataset?.name ?? "…"}</p>
        </div>
        <nav className="flex items-center gap-3 text-xs">
          <Link
            to="/datasets/$datasetId"
            params={{ datasetId }}
            activeOptions={{ exact: true }}
            activeProps={{ className: "text-foreground" }}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Spreadsheet
          </Link>
          <Link
            to="/datasets/$datasetId/review"
            params={{ datasetId }}
            activeProps={{ className: "text-foreground" }}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Review
          </Link>
          <Link
            to="/datasets/$datasetId/report"
            params={{ datasetId }}
            activeProps={{ className: "text-foreground" }}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Report
          </Link>
        </nav>
        {dataset !== undefined ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {dataset.rowCount.toLocaleString()} rows · {dataset.columnCount} columns ·{" "}
            {dataset.aiColumns.length} AI {dataset.aiColumns.length === 1 ? "column" : "columns"}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        {isPending ? (
          <p className="p-6 text-xs text-muted-foreground">Loading dataset…</p>
        ) : error !== null ? (
          <p className="p-6 text-xs text-destructive">
            {error instanceof Error ? error.message : "Could not load this dataset."}
          </p>
        ) : dataset === undefined ? (
          <p className="p-6 text-xs text-muted-foreground">This dataset does not exist.</p>
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  )
}
