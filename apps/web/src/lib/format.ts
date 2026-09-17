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
