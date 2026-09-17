/**
 * Evaluation harness.
 *
 * Measures a column against hand-authored ground truth, and answers the
 * question the whole differentiation rests on: **does confidence separate rows
 * the model got right from rows it got wrong?** If it does not, confidence is
 * decoration and the "proof of accuracy" position is dead.
 *
 *   npx tsx eval/measure.ts [columnName]
 *
 * Ground truth lives in `customer-feedback.labels.tsv`, authored alongside the
 * sample data so the intent of each row is known rather than inferred.
 */
import { readFileSync, existsSync } from "node:fs"
import { Pool } from "pg"

if (existsSync(".env")) process.loadEnvFile(".env")

const columnName = process.argv[2] ?? "Feature request?"

interface Label {
  readonly ticketId: string
  readonly groundTruth: "yes" | "no" | "unknown"
  readonly note: string
}

const labels: Label[] = readFileSync("eval/customer-feedback.labels.tsv", "utf8")
  .split("\n")
  .slice(1)
  .filter((line) => line.trim() !== "")
  .map((line) => {
    const [ticketId, groundTruth, note] = line.split("\t")
    return { ticketId: ticketId!, groundTruth: groundTruth as Label["groundTruth"], note: note ?? "" }
  })

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(0)}%`)

const bar = (p: number, width = 18): string => {
  const filled = Math.round(p * width)
  return `${"█".repeat(filled)}${"·".repeat(width - filled)}`
}

const main = async () => {
  const pool = new Pool({ connectionString: process.env["DATABASE_URL"] })
  try {
    const dataset = await pool.query(
      `SELECT id, name FROM dataset WHERE filename = 'customer-feedback.csv'
       ORDER BY created_at DESC LIMIT 1`
    )
    if (dataset.rowCount === 0) {
      console.error("No sample dataset found. Create one with 'Try it with sample data'.")
      process.exit(1)
    }
    const datasetId = dataset.rows[0].id as string

    const column = await pool.query(
      `SELECT id, name, type, instruction, needs_review_threshold
       FROM ai_column WHERE dataset_id = $1 AND name = $2 LIMIT 1`,
      [datasetId, columnName]
    )
    if (column.rowCount === 0) {
      console.error(`No column named "${columnName}" on dataset ${datasetId}.`)
      process.exit(1)
    }
    const col = column.rows[0]

    const rows = await pool.query(
      `SELECT r.status, r.selected_value, r.confidence, r.sufficiency, dr.data
       FROM result r JOIN dataset_row dr ON dr.id = r.row_id
       WHERE r.ai_column_id = $1`,
      [col.id]
    )

    const byTicket = new Map<string, (typeof rows.rows)[number]>()
    for (const row of rows.rows) byTicket.set((row.data as Record<string, string>)["ticket_id"]!, row)

    console.log(`\n══ Column: "${col.name}" (${col.type})`)
    console.log(`   instruction: ${col.instruction}`)
    console.log(`   threshold:   ${col.needs_review_threshold}`)
    console.log(`   labels:      ${labels.length} rows tagged`)

    // Split ground truth into answerable and deliberately-unusable.
    const answerable = labels.filter((l) => l.groundTruth !== "unknown")
    const unknown = labels.filter((l) => l.groundTruth === "unknown")

    // ── Coverage ────────────────────────────────────────────────────────────
    const unusable = (status: string): boolean => status === "unable_to_determine" || status === "failed"
    const answeredAnswerable = answerable.filter((l) => {
      const r = byTicket.get(l.ticketId)
      return r !== undefined && !unusable(r.status as string)
    })
    const discardedAnswerable = answerable.filter((l) => {
      const r = byTicket.get(l.ticketId)
      return r !== undefined && unusable(r.status as string)
    })
    const caughtUnknown = unknown.filter((l) => {
      const r = byTicket.get(l.ticketId)
      return r !== undefined && unusable(r.status as string)
    })

    console.log(`\n── Coverage`)
    console.log(`   answerable rows answered:   ${answeredAnswerable.length}/${answerable.length}  (${pct(answeredAnswerable.length, answerable.length)})`)
    console.log(`   answerable rows discarded:  ${discardedAnswerable.length}  ← false unusables`)
    for (const l of discardedAnswerable) console.log(`        · ${l.ticketId}  ${l.note}`)
    console.log(`   unusable rows caught:       ${caughtUnknown.length}/${unknown.length}  (${pct(caughtUnknown.length, unknown.length)})`)

    // ── Agreement ───────────────────────────────────────────────────────────
    const judged = answeredAnswerable
      .map((l) => {
        const r = byTicket.get(l.ticketId)!
        const predicted = String(r.selected_value ?? "").toLowerCase()
        const truth = l.groundTruth
        const correct = predicted === truth || (predicted === "yes" && truth === "yes") || (predicted === "no" && truth === "no")
        return { label: l, confidence: r.confidence as number | null, correct }
      })

    const correctCount = judged.filter((j) => j.correct).length
    const positives = judged.filter((j) => j.label.groundTruth === "yes")
    const negatives = judged.filter((j) => j.label.groundTruth === "no")
    const truePositives = positives.filter((j) => j.correct).length
    const trueNegatives = negatives.filter((j) => j.correct).length

    console.log(`\n── Agreement (on rows the model chose to answer)`)
    console.log(`   overall:          ${correctCount}/${judged.length}  (${pct(correctCount, judged.length)})`)
    console.log(`   minority ("yes"): ${truePositives}/${positives.length}  (${pct(truePositives, positives.length)})  ← the number that matters`)
    console.log(`   majority ("no"):  ${trueNegatives}/${negatives.length}  (${pct(trueNegatives, negatives.length)})`)

    // The baseline that flatters a lazy model.
    const majority = Math.max(positives.length, negatives.length)
    console.log(`\n   ⚠ base rate: ${pct(majority, judged.length)} of answerable rows are a single class.`)
    console.log(`     "Always say ${positives.length > negatives.length ? "yes" : "no"}" scores ${pct(majority, judged.length)} overall`)
    console.log(`     and ${pct(0, 1)} on the minority class. Overall accuracy hides this; report per class.`)

    // ── The E4 question: does confidence separate? ──────────────────────────
    const withConfidence = judged.filter((j) => j.confidence !== null)
    console.log(`\n── Does confidence separate right from wrong?  (${withConfidence.length} rows)`)
    if (withConfidence.length === 0) {
      console.log("   no rows carry a confidence value — cannot answer")
    } else {
      const buckets = [
        { name: "0.00–0.79", test: (c: number) => c < 0.8 },
        { name: "0.80–0.94", test: (c: number) => c >= 0.8 && c < 0.95 },
        { name: "0.95–1.00", test: (c: number) => c >= 0.95 }
      ]
      for (const bucket of buckets) {
        const inBucket = withConfidence.filter((j) => bucket.test(j.confidence!))
        if (inBucket.length === 0) continue
        const right = inBucket.filter((j) => j.correct).length
        console.log(
          `   ${bucket.name}  ${bar(right / inBucket.length)}  ${pct(right, inBucket.length)}  (${right}/${inBucket.length})`
        )
      }
      const spread = new Set(withConfidence.map((j) => j.confidence))
      console.log(`\n   distinct confidence values: ${spread.size} of ${withConfidence.length} rows`)
      console.log(`   range: ${Math.min(...[...spread] as number[]).toFixed(2)} – ${Math.max(...[...spread] as number[]).toFixed(2)}`)
      if (spread.size <= 2) {
        console.log(`   ✗ SATURATED — confidence cannot rank rows, so it cannot gate review.`)
      }
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
