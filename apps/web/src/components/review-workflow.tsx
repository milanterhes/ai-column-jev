import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "../../components/ui/button.tsx"
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx"
import { api, type DatasetDetail, type ResultDto } from "../api/client.ts"
import { formatConfidence, statusLabel, statusText } from "../lib/format.ts"

interface ReviewWorkflowProps {
  dataset: DatasetDetail
  resultsByColumn: Record<string, ResultDto[]>
  columnId: string | undefined
  onSelectColumn: (columnId: string) => void
  onChanged: () => void
}

const needsAttention = (result: ResultDto): boolean => {
  if (result.correctedValue !== null) return false
  return (
    result.status === "needs_review" ||
    result.status === "unable_to_determine" ||
    result.status === "failed"
  )
}

export function ReviewWorkflow({
  dataset,
  resultsByColumn,
  columnId,
  onSelectColumn,
  onChanged
}: ReviewWorkflowProps) {
  const column = dataset.aiColumns.find((entry) => entry.id === columnId) ?? dataset.aiColumns[0]
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)

  const queue = useMemo(() => {
    if (column === undefined) return []
    const byRowIndex = new Map(dataset.rows.map((row) => [row.id, row.rowIndex]))
    return (resultsByColumn[column.id] ?? [])
      .filter(needsAttention)
      .slice()
      .sort((a, b) => (byRowIndex.get(a.rowId) ?? 0) - (byRowIndex.get(b.rowId) ?? 0))
  }, [column, dataset.rows, resultsByColumn])

  const pending = queue.filter((result) => !skipped.has(result.rowId))
  const current = pending[0] ?? null
  const currentRow =
    current === null ? undefined : dataset.rows.find((row) => row.id === current.rowId)

  const apply = useCallback(
    async (value: string | undefined) => {
      if (column === undefined || current === null || value === undefined) return
      setBusy(true)
      try {
        await api.putCorrection(dataset.id, column.id, current.rowId, value)
        onChanged()
      } finally {
        setBusy(false)
      }
    },
    [column, current, dataset.id, onChanged]
  )

  const skip = useCallback(() => {
    if (current === null) return
    setSkipped((previous) => {
      const next = new Set(previous)
      next.add(current.rowId)
      return next
    })
  }, [current])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return
      }
      if (current === null || column === undefined) return
      const key = event.key.toLowerCase()
      if (key === "s") {
        skip()
        return
      }
      if (column.type === "yes_no") {
        if (key === "y") {
          void apply(column.labels[0]?.name)
          return
        }
        if (key === "n") {
          void apply(column.labels[1]?.name)
          return
        }
      }
      const position = Number(event.key)
      if (Number.isInteger(position) && position >= 1 && position <= column.labels.length) {
        void apply(column.labels[position - 1]?.name)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [apply, column, current, skip])

  if (dataset.aiColumns.length === 0) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="text-sm">This dataset has no AI columns yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add one from the spreadsheet, then run it to build a review queue.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-4 py-4">
      <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Reviewing</span>
          <NativeSelect
            value={column?.id ?? ""}
            onChange={(event) => {
              setSkipped(new Set())
              onSelectColumn(event.target.value)
            }}
          >
            {dataset.aiColumns.map((entry) => (
              <NativeSelectOption key={entry.id} value={entry.id}>
                {entry.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="text-xs text-muted-foreground">
          {pending.length.toLocaleString()} left · {queue.length.toLocaleString()} in queue
        </div>
      </div>

      {current === null || currentRow === undefined || column === undefined ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm">Nothing left to review.</p>
          {skipped.size > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setSkipped(new Set())}>
              Resume {skipped.size} skipped
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Every uncertain row in this column has a human answer.
            </p>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Row {currentRow.rowIndex + 1} · {statusLabel(current.status)}
            </span>
            <span className="text-xs text-muted-foreground">
              Model answer: {current.selectedValue ?? statusText(current.status)}
              {current.confidence !== null
                ? ` (${formatConfidence(current.confidence)})`
                : ""}
            </span>
          </div>

          <dl className="flex flex-col border border-border">
            {dataset.columns.map((header) => (
              <div
                key={header}
                className="grid grid-cols-[10rem_1fr] gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <dt className="truncate text-xs text-muted-foreground" title={header}>
                  {header}
                </dt>
                <dd className="text-xs break-words">{currentRow.data[header] ?? ""}</dd>
              </div>
            ))}
          </dl>

          {current.distribution.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {current.distribution.map((entry) => (
                <div key={entry.label} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 truncate text-xs" title={entry.label}>
                    {entry.label}
                  </span>
                  <div className="h-1.5 flex-1 bg-muted">
                    <div
                      className="h-full bg-foreground/70"
                      style={{ width: `${Math.round(entry.probability * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {Math.round(entry.probability * 100)}%
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-xs text-muted-foreground">
              Your answer — press{" "}
              {column.type === "yes_no" ? "Y / N" : "1–" + String(column.labels.length)} to correct,
              S to skip.
            </p>
            <div className="flex flex-wrap gap-2">
              {column.labels.map((label, index) => (
                <Button
                  key={label.name}
                  variant={index === 0 ? "default" : "outline"}
                  onClick={() => void apply(label.name)}
                  disabled={busy}
                >
                  {label.name}
                  <span className="ml-1 text-[10px] text-muted-foreground">{index + 1}</span>
                </Button>
              ))}
              <Button variant="ghost" onClick={skip} disabled={busy}>
                Skip (S)
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
