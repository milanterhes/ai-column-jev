import { useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Spreadsheet } from "../../../components/spreadsheet.tsx"
import { useDataset, useRefreshDataset, useResults } from "../../../api/hooks.ts"
import type { GridSearch } from "../../../lib/grid-search.ts"

export const Route = createFileRoute("/datasets/$datasetId/")({
  validateSearch: (search: Record<string, unknown>): GridSearch => ({
    q: typeof search.q === "string" ? search.q : undefined,
    status: typeof search.status === "string" ? search.status : undefined,
    hide: typeof search.hide === "string" ? search.hide : undefined,
    sort: typeof search.sort === "string" ? search.sort : undefined,
    dir: search.dir === "asc" || search.dir === "desc" ? search.dir : undefined,
    by: search.by === "value" || search.by === "confidence" ? search.by : undefined
  }),
  component: SpreadsheetPage
})

function SpreadsheetPage() {
  const { datasetId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: dataset } = useDataset(datasetId)
  const refresh = useRefreshDataset(datasetId)

  const columnIds = useMemo(() => dataset?.aiColumns.map((column) => column.id) ?? [], [dataset])
  const [poll, setPoll] = useState(true)
  const resultsQuery = useResults(datasetId, columnIds, poll)

  useEffect(() => {
    if (dataset === undefined || resultsQuery.data === undefined) return
    const data = resultsQuery.data
    setPoll(
      dataset.aiColumns.some((column) => (data[column.id]?.length ?? 0) < dataset.rows.length)
    )
  }, [dataset, resultsQuery.data])

  if (dataset === undefined) return null

  return (
    <Spreadsheet
      dataset={dataset}
      resultsByColumn={resultsQuery.data ?? {}}
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
      onChanged={refresh}
    />
  )
}
