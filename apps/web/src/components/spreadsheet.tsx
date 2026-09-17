import { useMemo, useRef, useState } from "react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState
} from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Link } from "@tanstack/react-router"
import { Button } from "../../components/ui/button.tsx"
import { Input } from "../../components/ui/input.tsx"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../../components/ui/dialog.tsx"
import { AddColumnDrawer } from "./add-column-drawer.tsx"
import { RowDetailPanel } from "./row-detail-panel.tsx"
import { cn } from "../../lib/utils.ts"
import {
  api,
  type DatasetDetail,
  type DatasetRowDto,
  type ResultDto,
  type ResultStatus
} from "../api/client.ts"
import {
  STATUS_ORDER,
  aiKey,
  effectiveValue,
  formatConfidence,
  isAiKey,
  originalKey,
  statusLabel,
  statusText
} from "../lib/format.ts"
import { parseHidden, parseStatusFilter, serializeHidden, serializeStatusFilter, type GridSearch, type StatusFilter } from "../lib/grid-search.ts"

interface GridRow {
  row: DatasetRowDto
  results: Record<string, ResultDto>
}

interface SpreadsheetProps {
  dataset: DatasetDetail
  resultsByColumn: Record<string, ResultDto[]>
  search: GridSearch
  onSearchChange: (next: GridSearch) => void
  onChanged: () => void
}

const ROW_HEIGHT = 32
const ORIGINAL_WIDTH = 220
const AI_WIDTH = 200

const widthFor = (id: string): number => (isAiKey(id) ? AI_WIDTH : ORIGINAL_WIDTH)

function SemanticCell({ result }: { result: ResultDto | undefined }) {
  if (result === undefined) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  const value = effectiveValue(result)
  const confidence = formatConfidence(result.confidence)
  const corrected = result.correctedValue !== null
  const needsReview = result.status === "needs_review" && !corrected
  return (
    <span className="flex w-full items-center gap-1.5 overflow-hidden">
      <span className={cn("truncate", value === null && "text-muted-foreground")}>
        {value ?? statusText(result.status)}
      </span>
      {confidence !== null ? (
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{confidence}</span>
      ) : null}
      {needsReview ? (
        <span className="shrink-0 text-amber-600" title="Needs review">
          ⚠
        </span>
      ) : null}
      {corrected ? (
        <span className="shrink-0 border border-border px-1 text-[10px] text-muted-foreground">
          edited
        </span>
      ) : null}
    </span>
  )
}

export function Spreadsheet({
  dataset,
  resultsByColumn,
  search,
  onSearchChange,
  onChanged
}: SpreadsheetProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [includeConfidence, setIncludeConfidence] = useState(true)
  const [selected, setSelected] = useState<{ rowId: string; columnId: string } | null>(null)

  const statusFilter = useMemo(() => parseStatusFilter(search.status), [search.status])
  const hidden = useMemo(() => parseHidden(search.hide), [search.hide])
  const sortBy = search.by ?? "value"

  const data = useMemo<GridRow[]>(() => {
    const lookups: Record<string, Record<string, ResultDto>> = {}
    for (const column of dataset.aiColumns) {
      const map: Record<string, ResultDto> = {}
      for (const result of resultsByColumn[column.id] ?? []) map[result.rowId] = result
      lookups[column.id] = map
    }
    return dataset.rows.map((row) => {
      const perRow: Record<string, ResultDto> = {}
      for (const column of dataset.aiColumns) {
        const result = lookups[column.id]?.[row.id]
        if (result !== undefined) perRow[column.id] = result
      }
      return { row, results: perRow }
    })
  }, [dataset.rows, dataset.aiColumns, resultsByColumn])

  const columns = useMemo<ColumnDef<GridRow>[]>(() => {
    const originals = dataset.columns.map<ColumnDef<GridRow>>((header) => ({
      id: originalKey(header),
      accessorFn: (row) => row.row.data[header] ?? "",
      header
    }))

    const ai = dataset.aiColumns.map<ColumnDef<GridRow>>((column) => ({
      id: aiKey(column.id),
      header: column.name,
      accessorFn: (row) => {
        const result = row.results[column.id]
        return effectiveValue(result) ?? (result === undefined ? "" : statusText(result.status))
      },
      sortingFn: (rowA, rowB) => {
        const a = rowA.original.results[column.id]
        const b = rowB.original.results[column.id]
        if (sortBy === "confidence") {
          return (a?.confidence ?? -1) - (b?.confidence ?? -1)
        }
        if (column.type === "score") {
          const order = column.labels.map((label) => label.name)
          return order.indexOf(effectiveValue(a) ?? "") - order.indexOf(effectiveValue(b) ?? "")
        }
        return String(effectiveValue(a) ?? "").localeCompare(String(effectiveValue(b) ?? ""))
      },
      filterFn: (row, _columnId, filterValue: ResultStatus[]) => {
        const result = row.original.results[column.id]
        if (result === undefined) return false
        return filterValue.includes(result.status)
      }
    }))

    return [...originals, ...ai]
  }, [dataset.columns, dataset.aiColumns, sortBy])

  const sorting = useMemo<SortingState>(
    () => (search.sort === undefined ? [] : [{ id: search.sort, desc: search.dir === "desc" }]),
    [search.sort, search.dir]
  )

  const columnFilters = useMemo<ColumnFiltersState>(
    () => Object.entries(statusFilter).map(([id, value]) => ({ id, value })),
    [statusFilter]
  )

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility: hidden, globalFilter: search.q ?? "" },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _columnId, filterValue: string) => {
      const needle = filterValue.trim().toLowerCase()
      if (needle === "") return true
      return dataset.columns.some((header) =>
        (row.original.row.data[header] ?? "").toLowerCase().includes(needle)
      )
    }
  })

  const rows = table.getRowModel().rows
  const visibleColumns = table.getVisibleLeafColumns()
  const template = visibleColumns.map((column) => `${widthFor(column.id)}px`).join(" ")
  const totalWidth = visibleColumns.reduce((sum, column) => sum + widthFor(column.id), 0)
  const firstVisibleAiIndex = visibleColumns.findIndex((column) => isAiKey(column.id))

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
    scrollMargin: ROW_HEIGHT
  })

  const toggleSort = (id: string, mode?: "value" | "confidence") => {
    const desc = search.sort === id && search.dir !== "desc"
    onSearchChange({
      ...search,
      sort: id,
      dir: desc ? "desc" : "asc",
      by: mode ?? (isAiKey(id) ? sortBy : "value")
    })
  }

  const toggleStatus = (columnId: string, status: ResultStatus) => {
    const key = aiKey(columnId)
    const current = statusFilter[key] ?? []
    const next = current.includes(status)
      ? current.filter((entry) => entry !== status)
      : [...current, status]
    const nextFilter: StatusFilter = { ...statusFilter }
    if (next.length === 0) delete nextFilter[key]
    else nextFilter[key] = next
    onSearchChange({ ...search, status: serializeStatusFilter(nextFilter) })
  }

  const toggleHidden = (key: string) => {
    const next = { ...hidden }
    if (next[key] === false) delete next[key]
    else next[key] = false
    onSearchChange({ ...search, hide: serializeHidden(next) })
  }

  const correct = async (columnId: string, rowId: string, value: string) => {
    await api.putCorrection(dataset.id, columnId, rowId, value)
    onChanged()
  }

  const revert = async (columnId: string, rowId: string) => {
    await api.deleteCorrection(dataset.id, columnId, rowId)
    onChanged()
  }

  const selectedColumn = selected === null ? undefined : dataset.aiColumns.find((column) => column.id === selected.columnId)
  const selectedRow = selected === null ? undefined : data.find((entry) => entry.row.id === selected.rowId)
  const selectedResult =
    selected === null ? undefined : selectedRow?.results[selected.columnId]

  const filtersActive =
    (search.q ?? "") !== "" || Object.keys(statusFilter).length > 0 || search.sort !== undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button size="sm" onClick={() => setDrawerOpen(true)}>
          + AI column
        </Button>
        <Link
          to="/datasets/$datasetId/review"
          params={{ datasetId: dataset.id }}
          className="inline-flex h-7 items-center border border-border px-2.5 text-xs transition-colors hover:bg-muted"
        >
          Review
        </Link>
        <div className="mx-1 h-5 w-px bg-border" />
        <div className="relative">
          <Input
            value={search.q ?? ""}
            onChange={(event) =>
              onSearchChange({ ...search, q: event.target.value === "" ? undefined : event.target.value })
            }
            placeholder="Search rows"
            className="w-52"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => setColumnsOpen(true)}>
          Columns
        </Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeConfidence}
            onChange={(event) => setIncludeConfidence(event.target.checked)}
          />
          Confidence
        </label>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <a href={api.exportUrl(dataset.id, includeConfidence)} download>
              Export CSV
            </a>
          }
        />
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {filtersActive ? (
            <button
              type="button"
              className="underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => onSearchChange({})}
            >
              Clear filters
            </button>
          ) : null}
          <span>
            {rows.length.toLocaleString()} of {data.length.toLocaleString()} rows
          </span>
        </div>
      </div>

      {dataset.aiColumns.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border px-3 py-2">
          {dataset.aiColumns.map((column) => (
            <div key={column.id} className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{column.name}</span>
              {STATUS_ORDER.map((status) => {
                const active = (statusFilter[aiKey(column.id)] ?? []).includes(status)
                const count = (resultsByColumn[column.id] ?? []).filter(
                  (result) => result.status === status
                ).length
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => toggleStatus(column.id, status)}
                    className={cn(
                      "border px-1.5 py-0.5 text-[10px] transition-colors",
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    title={statusLabel(status)}
                  >
                    {statusLabel(status)} {count}
                  </button>
                )
              })}
            </div>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            {data.length * dataset.aiColumns.length === 1
              ? "1 evaluation"
              : `${(data.length * dataset.aiColumns.length).toLocaleString()} evaluations`}
          </span>
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div
          className="sticky top-0 z-20 grid border-b border-border bg-background"
          style={{ gridTemplateColumns: template, width: totalWidth }}
        >
          {table.getHeaderGroups()[0]?.headers
            .filter((header) => header.column.getIsVisible())
            .map((header) => {
              const isAi = isAiKey(header.column.id)
              const index = visibleColumns.findIndex((column) => column.id === header.column.id)
              const sorted = search.sort === header.column.id
              const aiColumn = isAi
                ? dataset.aiColumns.find((column) => aiKey(column.id) === header.column.id)
                : undefined
              return (
                <div
                  key={header.id}
                  className={cn(
                    "flex h-8 min-w-0 items-center gap-1 border-r border-border px-2",
                    isAi && "bg-primary/10",
                    index === firstVisibleAiIndex && "border-l border-l-foreground/30"
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-medium"
                    onClick={() => toggleSort(header.column.id)}
                  >
                    <span className="truncate">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </span>
                    {sorted && !isAi ? (
                      <span className="shrink-0 text-muted-foreground">
                        {search.dir === "desc" ? "↓" : "↑"}
                      </span>
                    ) : null}
                  </button>
                  {aiColumn !== undefined ? (
                    <button
                      type="button"
                      className={cn(
                        "shrink-0 border px-1 text-[10px]",
                        sorted && sortBy === "confidence"
                          ? "border-foreground text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      )}
                      title="Sort by confidence"
                      onClick={() => toggleSort(header.column.id, "confidence")}
                    >
                      conf
                      {sorted && sortBy === "confidence" ? (search.dir === "desc" ? " ↓" : " ↑") : ""}
                    </button>
                  ) : null}
                  {aiColumn !== undefined && sorted && sortBy === "value" ? (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {search.dir === "desc" ? "↓" : "↑"}
                    </span>
                  ) : null}
                </div>
              )
            })}
        </div>

        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: totalWidth }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const tableRow = rows[virtualRow.index]
            if (tableRow === undefined) return null
            return (
              <div
                key={tableRow.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: totalWidth,
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start - ROW_HEIGHT}px)`,
                  gridTemplateColumns: template
                }}
                className="grid border-b border-border hover:bg-muted/40"
              >
                {tableRow.getVisibleCells().map((cell, index) => {
                  const isAi = isAiKey(cell.column.id)
                  const column = isAi
                    ? dataset.aiColumns.find((entry) => aiKey(entry.id) === cell.column.id)
                    : undefined
                  const result = column === undefined ? undefined : tableRow.original.results[column.id]
                  const isSelected =
                    selected !== null &&
                    selected.rowId === tableRow.original.row.id &&
                    column !== undefined &&
                    selected.columnId === column.id
                  return (
                    <div
                      key={cell.id}
                      className={cn(
                        "min-w-0 border-r border-border",
                        index === firstVisibleAiIndex && "border-l border-l-foreground/30",
                        isSelected && "bg-muted"
                      )}
                    >
                      {column !== undefined ? (
                        <button
                          type="button"
                          className="flex h-full w-full items-center px-2 text-left"
                          onClick={() =>
                            setSelected({ rowId: tableRow.original.row.id, columnId: column.id })
                          }
                        >
                          <SemanticCell result={result} />
                        </button>
                      ) : (
                        <div
                          className="flex h-full items-center truncate px-2 text-xs"
                          title={String(cell.getValue() ?? "")}
                        >
                          {String(cell.getValue() ?? "")}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {selectedColumn !== undefined && selectedRow !== undefined ? (
        <RowDetailPanel
          dataset={dataset}
          column={selectedColumn}
          row={selectedRow.row}
          result={selectedResult}
          onClose={() => setSelected(null)}
          onCorrect={(value) => correct(selectedColumn.id, selectedRow.row.id, value)}
          onRevert={() => revert(selectedColumn.id, selectedRow.row.id)}
        />
      ) : null}

      <AddColumnDrawer
        datasetId={dataset.id}
        headers={dataset.columns}
        rows={dataset.rows}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onChanged={onChanged}
      />

      <Dialog open={columnsOpen} onOpenChange={setColumnsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Columns</DialogTitle>
            <DialogDescription>Show or hide any column in the sheet.</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {table.getAllLeafColumns().map((column) => (
              <label key={column.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={column.getIsVisible()}
                  onChange={() => toggleHidden(column.id)}
                />
                <span className="truncate">
                  {String(column.columnDef.header ?? column.id)}
                </span>
                {isAiKey(column.id) ? (
                  <span className="text-[10px] text-muted-foreground">AI</span>
                ) : null}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setColumnsOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
