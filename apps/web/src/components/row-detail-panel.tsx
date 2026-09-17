import { useEffect, useState } from "react"
import { Button } from "../../components/ui/button.tsx"
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx"
import type { AiColumnDto, DatasetDetail, DatasetRowDto, ResultDto } from "../api/client.ts"
import { formatAnswer, formatConfidence, statusLabel, statusText } from "../lib/format.ts"

interface RowDetailPanelProps {
  dataset: DatasetDetail
  column: AiColumnDto
  row: DatasetRowDto
  result: ResultDto | undefined
  onClose: () => void
  onCorrect: (value: string) => Promise<void>
  onRevert: () => Promise<void>
}

export function RowDetailPanel({
  dataset,
  column,
  row,
  result,
  onClose,
  onCorrect,
  onRevert
}: RowDetailPanelProps) {
  const corrected = result?.correctedValue ?? null
  const effective = corrected ?? result?.selectedValue ?? null
  const [choice, setChoice] = useState(effective ?? column.labels[0]?.name ?? "")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setChoice(effective ?? column.labels[0]?.name ?? "")
  }, [row.id, column.id, effective])

  const confidence = formatConfidence(result?.confidence ?? null)

  const apply = async () => {
    setBusy(true)
    try {
      await onCorrect(choice)
    } finally {
      setBusy(false)
    }
  }

  const revert = async () => {
    setBusy(true)
    try {
      await onRevert()
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-96 flex-col border-l border-border bg-background">
      <div className="flex items-start justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-xs font-medium">{column.name}</p>
          <p className="text-xs text-muted-foreground">Row {row.rowIndex + 1}</p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close row detail">
          ×
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-border px-4 py-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Input</p>
          <dl className="flex flex-col gap-1.5">
            {dataset.columns.map((header) => (
              <div key={header} className="grid grid-cols-[8rem_1fr] gap-2">
                <dt className="truncate text-xs text-muted-foreground" title={header}>
                  {header}
                </dt>
                <dd className="text-xs break-words">{row.data[header] ?? ""}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-b border-border px-4 py-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Answer</p>
          <div className="flex items-baseline gap-2">
            <span className="text-sm">{effective ?? statusText(result?.status ?? "failed")}</span>
            {confidence !== null ? (
              <span className="text-xs text-muted-foreground">{confidence}</span>
            ) : null}
            {corrected !== null ? (
              <span className="border border-border px-1 text-[10px] text-muted-foreground">edited</span>
            ) : null}
          </div>
          {result !== undefined ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Status: {statusLabel(result.status)}
              {result.sufficiency !== null
                ? ` · sufficiency ${result.sufficiency.toFixed(2)}`
                : ""}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Not evaluated yet.</p>
          )}
          {corrected !== null && result?.selectedValue != null ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Model answer: <span className="line-through">{result.selectedValue}</span>
            </p>
          ) : null}
        </section>

        {result !== undefined && result.distribution.length > 0 ? (
          <section className="border-b border-border px-4 py-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Distribution</p>
            <div className="flex flex-col gap-1.5">
              {result.distribution.map((entry) => (
                <div key={entry.label} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-xs" title={entry.label}>
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
          </section>
        ) : null}

        {column.questions.length > 0 && result !== undefined ? (
          <section className="border-b border-border px-4 py-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Also asked</p>
            <dl className="flex flex-col gap-1.5">
              {column.questions.map((question) => (
                <div
                  key={question.key}
                  className="grid grid-cols-[1fr_auto] items-baseline gap-3"
                >
                  <dt className="text-xs text-muted-foreground" title={question.instruction}>
                    {question.instruction}
                  </dt>
                  <dd className="text-xs tabular-nums">
                    {formatAnswer(result.answers?.[question.key])}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Asked in the same request as the answer above, so they cost almost nothing extra.
            </p>
          </section>
        ) : null}

        <section className="px-4 py-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Correct this cell</p>
          <div className="flex items-center gap-2">
            <NativeSelect value={choice} onChange={(event) => setChoice(event.target.value)}>
              {column.labels.map((label) => (
                <NativeSelectOption key={label.name} value={label.name}>
                  {label.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button size="sm" onClick={apply} disabled={busy || choice === ""}>
              Apply
            </Button>
            {corrected !== null ? (
              <Button size="sm" variant="ghost" onClick={revert} disabled={busy}>
                Revert
              </Button>
            ) : null}
          </div>
        </section>
      </div>
    </aside>
  )
}
