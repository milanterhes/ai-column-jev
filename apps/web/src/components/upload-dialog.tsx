import { useRef, useState, type ChangeEvent, type DragEvent } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../../components/ui/dialog.tsx"
import { Button } from "../../components/ui/button.tsx"
import { api } from "../api/client.ts"
import { CsvError, parseCsvFile, type ParsedCsv } from "../lib/csv.ts"

interface UploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UploadDialog({ open, onOpenChange }: UploadDialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [creating, setCreating] = useState(false)

  const reset = () => {
    setFile(null)
    setParsed(null)
    setError(null)
    setDragging(false)
    setCreating(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const accept = async (candidate: File) => {
    setError(null)
    setParsed(null)
    setFile(candidate)
    try {
      setParsed(await parseCsvFile(candidate))
    } catch (cause) {
      setError(cause instanceof CsvError ? cause.message : "That file could not be read.")
    }
  }

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const candidate = event.target.files?.[0]
    if (candidate !== undefined) void accept(candidate)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    const candidate = event.dataTransfer.files?.[0]
    if (candidate !== undefined) void accept(candidate)
  }

  const create = async () => {
    if (file === null) return
    setCreating(true)
    setError(null)
    try {
      const dataset = await api.createDataset(file)
      await queryClient.invalidateQueries({ queryKey: ["datasets"] })
      handleOpenChange(false)
      await navigate({ to: "/datasets/$datasetId", params: { datasetId: dataset.id } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The upload failed.")
      setCreating(false)
    }
  }

  const previewRows = parsed?.rows.slice(0, 20) ?? []

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload a CSV</DialogTitle>
          <DialogDescription>
            Up to 50 MB, 100,000 rows and 256 columns. UTF-8 is assumed; Windows-1252 is
            used only when the file is not valid UTF-8.
          </DialogDescription>
        </DialogHeader>

        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={
            "flex cursor-pointer flex-col items-center justify-center gap-1 border border-dashed px-6 py-8 text-center transition-colors " +
            (dragging ? "border-foreground bg-muted" : "border-border hover:bg-muted/50")
          }
        >
          <p className="text-sm font-medium">Drop a CSV here, or click to choose a file</p>
          <p className="text-xs text-muted-foreground">The file is parsed in your browser first.</p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleInput}
          />
        </div>

        {error !== null ? (
          <p className="border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        {parsed !== null ? (
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
              <span className="font-medium">{parsed.filename}</span>
              <span className="text-muted-foreground">{parsed.rows.length.toLocaleString()} rows</span>
              <span className="text-muted-foreground">{parsed.headers.length} columns</span>
              {parsed.encoding === "windows-1252" ? (
                <span className="text-muted-foreground">
                  Decoded as Windows-1252 — the file was not valid UTF-8.
                </span>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-auto border border-border">
              <table className="w-max min-w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="border-b border-r border-border px-2 py-1.5 text-left font-medium text-muted-foreground">
                      #
                    </th>
                    {parsed.headers.map((header) => (
                      <th
                        key={header}
                        className="border-b border-r border-border px-2 py-1.5 text-left font-medium whitespace-nowrap"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="hover:bg-muted/40">
                      <td className="border-b border-r border-border px-2 py-1 text-right text-muted-foreground tabular-nums">
                        {rowIndex + 1}
                      </td>
                      {parsed.headers.map((header, cellIndex) => (
                        <td
                          key={header}
                          className="max-w-56 truncate border-b border-r border-border px-2 py-1"
                          title={row[cellIndex] ?? ""}
                        >
                          {row[cellIndex] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Showing the first {previewRows.length} of {parsed.rows.length.toLocaleString()} rows.
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={parsed === null || creating}>
            {creating ? "Creating…" : "Create dataset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
