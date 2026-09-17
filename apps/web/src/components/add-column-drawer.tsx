import { useEffect, useMemo, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../../components/ui/dialog.tsx"
import { Button } from "../../components/ui/button.tsx"
import { Input } from "../../components/ui/input.tsx"
import { Textarea } from "../../components/ui/textarea.tsx"
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx"
import { api, type ColumnType, type DatasetRowDto, type Label, type ResultDto } from "../api/client.ts"
import { columnTypeLabel, formatConfidence, statusText } from "../lib/format.ts"

interface AddColumnDrawerProps {
  datasetId: string
  headers: string[]
  rows: DatasetRowDto[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

const TYPES: ColumnType[] = ["yes_no", "category", "score"]
const PREVIEW_COUNTS = [5, 10, 15, 20, 30, 50]

const defaultLabels = (type: ColumnType): Label[] => {
  switch (type) {
    case "yes_no":
      return [
        { name: "Yes", description: "The row clearly satisfies the question." },
        { name: "No", description: "The row clearly does not satisfy the question." }
      ]
    case "category":
      return [{ name: "Category 1" }, { name: "Category 2" }]
    case "score":
      return [{ name: "Low" }, { name: "Medium" }, { name: "High" }]
  }
}

const signatureOf = (
  name: string,
  type: ColumnType,
  instruction: string,
  labels: Label[]
): string => JSON.stringify({ name, type, instruction, labels })

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface ExtraDraft {
  type: "yes_no" | "score"
  instruction: string
}

/**
 * Extra questions get a fixed label set. Editing them per question is a
 * reasonable next step; it is not here because the point of an extra is that it
 * is cheap to try, and a label editor per extra would make it expensive to ask.
 */
const extraLabels = (type: ExtraDraft["type"]): Label[] =>
  type === "yes_no"
    ? [
        { name: "Yes", what: "The answer is yes" },
        { name: "No", what: "The answer is no" }
      ]
    : [
        { name: "Low" },
        { name: "Medium" },
        { name: "High" }
      ]

export function AddColumnDrawer({
  datasetId,
  headers,
  rows,
  open,
  onOpenChange,
  onChanged
}: AddColumnDrawerProps) {
  const [name, setName] = useState("")
  const [type, setType] = useState<ColumnType>("yes_no")
  const [instruction, setInstruction] = useState("")
  const [labels, setLabels] = useState<Label[]>(() => defaultLabels("yes_no"))
  const [threshold, setThreshold] = useState(0.8)
  const [extras, setExtras] = useState<ExtraDraft[]>([])
  const [previewCount, setPreviewCount] = useState(10)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [createdSignature, setCreatedSignature] = useState<string | null>(null)
  const [promoted, setPromoted] = useState(false)
  const [busy, setBusy] = useState<"preview" | "run" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewResults, setPreviewResults] = useState<ResultDto[] | null>(null)
  const [originalInstruction, setOriginalInstruction] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [improving, setImproving] = useState(false)
  const createdRef = useRef<{ id: string; promoted: boolean } | null>(null)

  createdRef.current = createdId === null ? null : { id: createdId, promoted }

  const rowsById = useMemo(() => {
    const map = new Map<string, DatasetRowDto>()
    for (const row of rows) map.set(row.id, row)
    return map
  }, [rows])

  const examples = useMemo(() => {
    const subject = (headers[0] ?? "row").toLowerCase().replace(/_/g, " ")
    const second = (headers[1] ?? "").toLowerCase().replace(/_/g, " ")
    return [
      `Is this ${subject} a B2B SaaS company?`,
      `What category does this ${subject} belong to?`,
      second === "" ? `How strong is this ${subject}?` : `How does ${second} affect a good fit?`
    ]
  }, [headers])

  const addExtra = () => {
    setExtras((current) =>
      current.length >= 5 ? current : [...current, { type: "yes_no", instruction: "" }]
    )
  }

  const updateExtra = (index: number, patch: Partial<ExtraDraft>) => {
    setExtras((current) =>
      current.map((extra, position) => (position === index ? { ...extra, ...patch } : extra))
    )
  }

  const removeExtra = (index: number) => {
    setExtras((current) => current.filter((_, position) => position !== index))
  }

  const reset = () => {
    setName("")
    setType("yes_no")
    setInstruction("")
    setLabels(defaultLabels("yes_no"))
    setThreshold(0.8)
    setExtras([])
    setPreviewCount(10)
    setCreatedId(null)
    setCreatedSignature(null)
    setPromoted(false)
    setBusy(null)
    setError(null)
    setPreviewResults(null)
    setOriginalInstruction(null)
    setSuggestion(null)
    setImproving(false)
  }

  const deleteCreated = async () => {
    const current = createdRef.current
    if (current === null || current.promoted) return
    try {
      await api.deleteColumn(datasetId, current.id)
      onChanged()
    } catch {
      // The column is reaped with the dataset if this best-effort delete fails.
    }
  }

  useEffect(() => {
    return () => {
      const current = createdRef.current
      if (current !== null && !current.promoted) {
        void api.deleteColumn(datasetId, current.id).catch(() => undefined)
      }
    }
  }, [datasetId])

  const changeType = (next: ColumnType) => {
    setType(next)
    setLabels(defaultLabels(next))
    setPreviewResults(null)
  }

  const updateLabel = (index: number, patch: Partial<Label>) => {
    setLabels((current) =>
      current.map((label, position) => (position === index ? { ...label, ...patch } : label))
    )
  }

  const moveLabel = (index: number, direction: -1 | 1) => {
    setLabels((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      if (item !== undefined) next.splice(target, 0, item)
      return next
    })
  }

  const ensureColumn = async (): Promise<string | null> => {
    const signature = signatureOf(name, type, instruction, labels) + JSON.stringify(extras)
    if (createdId !== null && createdSignature === signature) return createdId
    if (createdId !== null) {
      await api.deleteColumn(datasetId, createdId)
      setCreatedId(null)
      setCreatedSignature(null)
    }
    const column = await api.createColumn(datasetId, {
      name: name.trim(),
      type,
      instruction: instruction.trim(),
      labels,
      needsReviewThreshold: threshold,
      questions: extras
        .filter((extra) => extra.instruction.trim() !== "")
        .map((extra, index) => ({
          key: `q${index + 1}`,
          type: extra.type,
          instruction: extra.instruction.trim(),
          labels: extraLabels(extra.type)
        }))
    })
    setCreatedId(column.id)
    setCreatedSignature(signature)
    onChanged()
    return column.id
  }

  const loadResults = async (columnId: string): Promise<ResultDto[]> => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const results = await api.getResults(datasetId, columnId)
      if (results.length > 0) return results
      await sleep(400)
    }
    return []
  }

  const preview = async () => {
    if (name.trim() === "" || instruction.trim() === "") {
      setError("Give the column a name and a question first.")
      return
    }
    setBusy("preview")
    setError(null)
    try {
      const columnId = await ensureColumn()
      if (columnId === null) return
      await api.previewColumn(datasetId, columnId, previewCount)
      setPreviewResults(await loadResults(columnId))
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The preview failed.")
    } finally {
      setBusy(null)
    }
  }

  const runAll = async () => {
    if (name.trim() === "" || instruction.trim() === "") {
      setError("Give the column a name and a question first.")
      return
    }
    setBusy("run")
    setError(null)
    try {
      const columnId = await ensureColumn()
      if (columnId === null) return
      await api.runColumn(datasetId, columnId)
      setPromoted(true)
      onChanged()
      onOpenChange(false)
      reset()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The run could not be started.")
    } finally {
      setBusy(null)
    }
  }

  const improve = async () => {
    if (instruction.trim() === "") return
    setImproving(true)
    setError(null)
    setSuggestion(null)
    try {
      const result = await api.improveInstruction(datasetId, {
        instruction: instruction.trim(),
        type,
        labels,
        headers
      })
      if (result.instruction !== undefined && result.instruction.trim() !== "") {
        setOriginalInstruction(instruction)
        setSuggestion(result.instruction)
      } else {
        setError("Couldn't help with that one.")
      }
    } catch {
      setError("Couldn't help with that one.")
    } finally {
      setImproving(false)
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      void deleteCreated()
      reset()
    }
    onOpenChange(next)
  }

  const previewRows = (previewResults ?? [])
    .map((result) => ({ result, row: rowsById.get(result.rowId) }))
    .filter((entry): entry is { result: ResultDto; row: DatasetRowDto } => entry.row !== undefined)
    .sort((a, b) => a.row.rowIndex - b.row.rowIndex)

  const sourceHeaders = headers.slice(0, 3)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add AI column</DialogTitle>
          <DialogDescription>
            Describe the judgment in plain language. Every evaluation sends the whole row to the
            model.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Column name</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="B2B SaaS?"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Output type</span>
              <div className="flex">
                {TYPES.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant={type === option ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => changeType(option)}
                  >
                    {columnTypeLabel(option)}
                  </Button>
                ))}
              </div>
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">What should this column determine?</span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={improve}
                disabled={improving || instruction.trim() === ""}
              >
                {improving ? "Improving…" : "Improve this"}
              </Button>
            </div>
            <Textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="Is this company primarily a B2B SaaS company?"
              rows={3}
            />
            {instruction.trim() === "" ? (
              <div className="flex flex-wrap gap-1.5">
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setInstruction(example)}
                    className="border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {example}
                  </button>
                ))}
              </div>
            ) : null}
            {suggestion !== null ? (
              <div className="flex flex-col gap-2 border border-border bg-muted/40 p-2">
                <p className="text-xs text-muted-foreground line-through">{originalInstruction}</p>
                <p className="text-xs">{suggestion}</p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="xs"
                    onClick={() => {
                      setInstruction(suggestion)
                      setSuggestion(null)
                    }}
                  >
                    Use suggestion
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      if (originalInstruction !== null) setInstruction(originalInstruction)
                      setSuggestion(null)
                    }}
                  >
                    Keep original
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">
                {type === "score" ? "Levels, in order" : "Labels"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setLabels((current) => [...current, { name: `Label ${current.length + 1}` }])}
              >
                Add label
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              {labels.map((label, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  {type === "score" ? (
                    <div className="flex flex-col">
                      <button
                        type="button"
                        className="px-1 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => moveLabel(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="px-1 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => moveLabel(index, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  ) : null}
                  <Input
                    value={label.name}
                    onChange={(event) => updateLabel(index, { name: event.target.value })}
                    className="w-40 shrink-0"
                  />
                  <Input
                    value={label.description ?? ""}
                    onChange={(event) => updateLabel(index, { description: event.target.value })}
                    placeholder="Description (used as criteria)"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setLabels((current) => current.filter((_, position) => position !== index))}
                    disabled={labels.length <= 2}
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Needs review below</span>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={threshold}
                onChange={(event) => setThreshold(Number(event.target.value))}
                className="w-20"
              />
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Also ask</span>
              <Button variant="ghost" size="sm" onClick={addExtra} disabled={extras.length >= 5}>
                Add a question
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Asked in the same request as the question above, so they cost a fraction more rather
              than doubling the run. They appear in the row detail.
            </p>
            {extras.map((extra, index) => (
              <div key={index} className="flex items-center gap-2">
                <NativeSelect
                  value={extra.type}
                  size="sm"
                  onChange={(event) =>
                    updateExtra(index, { type: event.target.value as ExtraDraft["type"] })
                  }
                >
                  <NativeSelectOption value="yes_no">Yes / No</NativeSelectOption>
                  <NativeSelectOption value="score">Low → High</NativeSelectOption>
                </NativeSelect>
                <Input
                  value={extra.instruction}
                  onChange={(event) => updateExtra(index, { instruction: event.target.value })}
                  placeholder="e.g. Does this report a bug?"
                />
                <Button variant="ghost" size="sm" onClick={() => removeExtra(index)}>
                  ×
                </Button>
              </div>
            ))}
          </div>

          {error !== null ? (
            <p className="border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          {previewRows.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium">Preview</p>
              <div className="overflow-x-auto border border-border">
                <table className="w-max min-w-full border-collapse text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="border-b border-r border-border px-2 py-1.5 text-left font-medium text-muted-foreground">
                        #
                      </th>
                      {sourceHeaders.map((header) => (
                        <th
                          key={header}
                          className="border-b border-r border-border px-2 py-1.5 text-left font-medium whitespace-nowrap"
                        >
                          {header}
                        </th>
                      ))}
                      <th className="border-b border-r border-border px-2 py-1.5 text-left font-medium whitespace-nowrap">
                        {name.trim() === "" ? "Answer" : name}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map(({ row, result }) => {
                      const confidence = formatConfidence(result.confidence)
                      return (
                        <tr key={row.id} className="hover:bg-muted/40">
                          <td className="border-b border-r border-border px-2 py-1 text-right text-muted-foreground tabular-nums">
                            {row.rowIndex + 1}
                          </td>
                          {sourceHeaders.map((header) => (
                            <td
                              key={header}
                              className="max-w-56 truncate border-b border-r border-border px-2 py-1"
                              title={row.data[header] ?? ""}
                            >
                              {row.data[header] ?? ""}
                            </td>
                          ))}
                          <td className="border-b border-r border-border px-2 py-1 whitespace-nowrap">
                            <span>{result.selectedValue ?? statusText(result.status)}</span>
                            {confidence !== null ? (
                              <span className="ml-2 text-muted-foreground">{confidence}</span>
                            ) : null}
                            {result.status === "needs_review" ? (
                              <span className="ml-1 text-muted-foreground" title="Needs review">
                                ⚠
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                {previewRows.length} rows spread evenly through your sheet.
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <label className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span>Preview rows</span>
            <NativeSelect
              value={String(previewCount)}
              onChange={(event) => setPreviewCount(Number(event.target.value))}
              size="sm"
            >
              {PREVIEW_COUNTS.map((count) => (
                <NativeSelectOption key={count} value={String(count)}>
                  {count}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={busy !== null}>
            Cancel
          </Button>
          {previewRows.length > 0 ? (
            <Button variant="outline" onClick={preview} disabled={busy !== null}>
              {busy === "preview" ? "Previewing…" : `Re-preview ${previewCount}`}
            </Button>
          ) : null}
          {previewRows.length > 0 ? (
            <Button onClick={runAll} disabled={busy !== null}>
              {busy === "run" ? "Starting…" : `Run on all ${rows.length.toLocaleString()} rows`}
            </Button>
          ) : (
            <Button onClick={preview} disabled={busy !== null}>
              {busy === "preview" ? "Previewing…" : `Preview on ${previewCount} rows`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
