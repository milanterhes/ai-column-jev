import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { api, type ColumnReport } from "../../../api/client.ts"
import { useDataset } from "../../../api/hooks.ts"
import { Button } from "../../../../components/ui/button.tsx"

export const Route = createFileRoute("/datasets/$datasetId/report")({
  component: ReportPage
})

const pct = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toFixed(0)}%`

function Rate({ value, tone = "normal" }: { value: number | null; tone?: "normal" | "warn" }) {
  const colour =
    value === null
      ? "text-muted-foreground"
      : tone === "warn" && value < 0.9
        ? "text-amber-600"
        : "text-foreground"
  return <span className={`tabular-nums ${colour}`}>{pct(value)}</span>
}

function ReportPage() {
  const { datasetId } = Route.useParams()
  const { data: dataset } = useDataset(datasetId)
  const [columnId, setColumnId] = useState<string | null>(null)
  const [report, setReport] = useState<ColumnReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (dataset === undefined) return null

  const active = columnId ?? dataset.aiColumns[0]?.id ?? null

  const load = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      setColumnId(id)
      setReport(await api.getReport(datasetId, id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the report.")
    } finally {
      setBusy(false)
    }
  }

  const audit = async () => {
    if (active === null) return
    setBusy(true)
    try {
      await api.startAudit(datasetId, active, 25)
      setReport(await api.getReport(datasetId, active))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the audit.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-lg font-semibold tracking-tight">How good is this column?</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Measured on your own rows. Two numbers, deliberately kept apart: what a human changed when
        they looked, and what a random sample says about rows nobody looked at.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {dataset.aiColumns.map((column) => (
          <Button
            key={column.id}
            size="sm"
            variant={column.id === active ? "default" : "outline"}
            onClick={() => void load(column.id)}
          >
            {column.name}
          </Button>
        ))}
      </div>

      {error !== null ? <p className="mt-4 text-xs text-destructive">{error}</p> : null}

      {active !== null && report === null && !busy ? (
        <p className="mt-6 text-xs text-muted-foreground">
          Choose a column above to measure it.
        </p>
      ) : null}

      {report !== null ? (
        <div className="mt-6 space-y-6">
          {report.warnings.length > 0 ? (
            <div className="border border-amber-600/40 bg-amber-500/5 p-3 text-xs">
              {report.warnings.map((warning) => (
                <p key={warning} className="text-amber-700 dark:text-amber-500">
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          <section>
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Coverage
            </h2>
            <dl className="mt-2 grid grid-cols-4 gap-3 text-sm">
              {[
                ["Judged", report.judged.toLocaleString()],
                ["Unusable", report.unusable.toLocaleString()],
                ["Failed", report.failed.toLocaleString()],
                ["Rows", report.total.toLocaleString()]
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Accuracy
            </h2>
            <div className="mt-2 grid grid-cols-2 gap-4">
              <div className="border border-border p-3">
                <p className="text-xs text-muted-foreground">Random audit</p>
                <p className="mt-1 text-2xl">
                  <Rate value={report.audit?.rate ?? null} />
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {report.audit === null
                    ? "Not run yet — this is the number that can be trusted."
                    : `${report.audit.agreed}/${report.audit.total} rows nobody had reviewed.`}
                </p>
                <Button className="mt-2" size="sm" variant="outline" onClick={() => void audit()} disabled={busy}>
                  {report.audit === null ? "Run a 25-row audit" : "Re-sample"}
                </Button>
              </div>
              <div className="border border-border p-3">
                <p className="text-xs text-muted-foreground">Agreement on reviewed rows</p>
                <p className="mt-1 text-2xl">
                  <Rate value={report.reviewed.rate} />
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {report.reviewed.agreed}/{report.reviewed.total} rows you looked at. Biased
                  toward the hard cases — not the same number as above.
                </p>
              </div>
            </div>
          </section>

          {report.reviewed.byClass.length > 0 ? (
            <section>
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                By class
              </h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Overall agreement hides an imbalanced sheet. These are the numbers that matter.
              </p>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {report.reviewed.byClass.map((row) => (
                    <tr key={row.label} className="border-b border-border last:border-0">
                      <td className="py-1.5">{row.label}</td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {row.agreed}/{row.total}
                      </td>
                      <td className="w-16 py-1.5 text-right">
                        <Rate value={row.rate} tone="warn" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <section>
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Base rate
            </h2>
            <div className="mt-2 space-y-1">
              {report.baseRate.map((entry) => (
                <div key={entry.label} className="flex items-center gap-2 text-xs">
                  <span className="w-32 shrink-0 truncate">{entry.label}</span>
                  <div className="h-1.5 flex-1 bg-muted">
                    <div className="h-full bg-foreground/70" style={{ width: `${entry.share * 100}%` }} />
                  </div>
                  <span className="w-10 text-right tabular-nums text-muted-foreground">
                    {(entry.share * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </section>

          {report.buckets.length > 0 ? (
            <section>
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Does confidence separate right from wrong?
              </h2>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {report.buckets.map((bucket) => (
                    <tr key={bucket.range} className="border-b border-border last:border-0">
                      <td className="py-1.5 font-mono text-xs">{bucket.range}</td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {bucket.agreed}/{bucket.total}
                      </td>
                      <td className="w-16 py-1.5 text-right">
                        <Rate value={bucket.rate} tone="warn" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {report.disagreements.length > 0 ? (
            <section>
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Where we disagreed
              </h2>
              <ul className="mt-2 divide-y divide-border text-sm">
                {report.disagreements.slice(0, 8).map((row) => (
                  <li key={row.rowId} className="flex items-center gap-3 py-1.5">
                    <span className="w-28 truncate text-muted-foreground">{row.model ?? "—"}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="w-28 truncate">{row.human}</span>
                    <span className="ml-auto tabular-nums text-xs text-muted-foreground">
                      {row.confidence === null ? "" : row.confidence.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
