import { useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { ReviewWorkflow } from "../../../components/review-workflow.tsx"
import { useDataset, useRefreshDataset, useResults } from "../../../api/hooks.ts"

interface ReviewSearch {
  column?: string | undefined
}

export const Route = createFileRoute("/datasets/$datasetId/review")({
  validateSearch: (search: Record<string, unknown>): ReviewSearch => ({
    column: typeof search.column === "string" ? search.column : undefined
  }),
  component: ReviewPage
})

function ReviewPage() {
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

  const selectedId =
    search.column !== undefined && dataset.aiColumns.some((column) => column.id === search.column)
      ? search.column
      : dataset.aiColumns[0]?.id

  return (
    <ReviewWorkflow
      dataset={dataset}
      resultsByColumn={resultsQuery.data ?? {}}
      columnId={selectedId}
      onSelectColumn={(columnId) => void navigate({ search: { column: columnId }, replace: true })}
      onChanged={refresh}
    />
  )
}
