import type { ResultDto, ResultStatus } from "../api/client.ts"

export const STATUS_ORDER: ResultStatus[] = [
  "high_confidence",
  "needs_review",
  "unable_to_determine",
  "failed"
]

export const statusLabel = (status: ResultStatus): string => {
  switch (status) {
    case "high_confidence":
      return "High confidence"
    case "needs_review":
      return "Needs review"
    case "unable_to_determine":
      return "Unable to determine"
    case "failed":
      return "Failed"
  }
}

export const statusText = (status: ResultStatus): string => {
  switch (status) {
    case "unable_to_determine":
      return "Unable to determine"
    case "failed":
      return "Failed"
    default:
      return statusLabel(status)
  }
}

export const isStatus = (value: string): value is ResultStatus =>
  (STATUS_ORDER as readonly string[]).includes(value)

export const formatConfidence = (confidence: number | null): string | null =>
  confidence === null ? null : `${Math.round(confidence * 100)}%`

export const effectiveValue = (result: ResultDto | undefined): string | null =>
  result === undefined ? null : result.correctedValue ?? result.selectedValue

export const hasAnswer = (result: ResultDto | undefined): boolean =>
  result !== undefined && result.selectedValue !== null

export const originalKey = (header: string): string => `o:${header}`
export const aiKey = (id: string): string => `a:${id}`

export const isAiKey = (key: string): boolean => key.startsWith("a:")
export const aiColumnIdFromKey = (key: string): string => key.slice(2)
export const headerFromKey = (key: string): string => key.slice(2)

export const columnTypeLabel = (type: string): string => {
  switch (type) {
    case "yes_no":
      return "Yes / No"
    case "category":
      return "Category"
    case "score":
      return "Score"
    default:
      return type
  }
}


/**
 * Render a raw provider answer — the shape Jev returns for one question —
 * as something readable. Kept here rather than in the panel because the
 * vocabulary it decodes is the provider's, not the UI's.
 */
export const formatAnswer = (answer: unknown): string => {
  if (answer === null || typeof answer !== "object") return "—"
  const record = answer as Record<string, unknown>

  if (record["type"] === "noul") {
    const p = Number(record["noul"] ?? 0)
    return p >= 0.5 ? `Yes ${(p * 100).toFixed(0)}%` : `No ${((1 - p) * 100).toFixed(0)}%`
  }

  if (record["type"] === "choice") {
    const confidence = record["confidence"]
    const value = String(record["choice"] ?? "—")
    return typeof confidence === "number"
      ? `${value} ${(confidence * 100).toFixed(0)}%`
      : value
  }

  if (record["type"] === "score") {
    const probabilities = record["probabilities"] as Record<string, number> | undefined
    const best = Object.entries(probabilities ?? {}).sort((a, b) => b[1] - a[1])[0]
    if (best === undefined) return "—"
    const legend = record["legend"] as Record<string, unknown> | undefined
    const entry = legend?.[best[0]]
    const label =
      typeof entry === "string"
        ? entry
        : typeof entry === "object" && entry !== null && "summary" in entry
          ? String((entry as { summary: unknown }).summary)
          : best[0]
    return `${label} ${(best[1] * 100).toFixed(0)}%`
  }

  return "—"
}
