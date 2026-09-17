export type ColumnType = "yes_no" | "category" | "score"

export type ResultStatus =
  | "high_confidence"
  | "needs_review"
  | "unable_to_determine"
  | "failed"

export interface Label {
  name: string
  description?: string | undefined
  /** Structured criteria sent to the provider. See corrections.md. */
  what?: string | undefined
  notFor?: string | undefined
  examples?: string[] | undefined
  signals?: string[] | undefined
}

export interface DatasetSummary {
  id: string
  name: string
  filename: string
  rowCount: number
  columnCount: number
  columns: string[]
  createdAt: string
}

export interface DatasetRowDto {
  id: string
  rowIndex: number
  data: Record<string, string>
}

export interface QuestionDto {
  key: string
  type: ColumnType
  instruction: string
  labels: Label[]
}

export interface AiColumnDto {
  id: string
  name: string
  type: ColumnType
  instruction: string
  labels: Label[]
  needsReviewThreshold: number
  /** Extra questions evaluated in the same request as the column's own. */
  questions: QuestionDto[]
}

export interface DatasetDetail extends DatasetSummary {
  rows: DatasetRowDto[]
  aiColumns: AiColumnDto[]
}

export interface DistributionEntry {
  label: string
  probability: number
}

export interface ResultDto {
  rowId: string
  selectedValue: string | null
  confidence: number | null
  sufficiency: number | null
  status: ResultStatus
  distribution: DistributionEntry[]
  correctedValue: string | null
  /** Raw provider answer per extra question, keyed by the question's key. */
  answers: Record<string, unknown>
}

export interface NewColumnInput {
  name: string
  type: ColumnType
  instruction: string
  labels: Label[]
  needsReviewThreshold?: number | undefined
  questions?: QuestionDto[] | undefined
}

export interface ImproveInstructionInput {
  instruction: string
  type: ColumnType
  labels: Label[]
  headers: string[]
}

export interface ImproveInstructionResult {
  instruction?: string | undefined
  labels?: Label[] | undefined
}

export interface ColumnReport {
  total: number
  judged: number
  unusable: number
  failed: number
  baseRate: Array<{ label: string; share: number }>
  reviewed: {
    total: number
    agreed: number
    rate: number | null
    byClass: Array<{ label: string; total: number; agreed: number; rate: number | null }>
  }
  buckets: Array<{ range: string; total: number; agreed: number; rate: number | null }>
  audit: { total: number; agreed: number; rate: number | null } | null
  disagreements: Array<{ rowId: string; model: string | null; human: string; confidence: number | null }>
  warnings: string[]
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api${path}`, { credentials: "include", ...init })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new ApiError(response.status, body.trim() || response.statusText)
  }
  if (response.status === 204) return undefined as T
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) return undefined as T
  return (await response.json()) as T
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
})

const columnBase = (datasetId: string, columnId: string): string =>
  `/datasets/${encodeURIComponent(datasetId)}/columns/${encodeURIComponent(columnId)}`

export const api = {
  listDatasets: () => request<DatasetSummary[]>("/datasets"),

  getDataset: (datasetId: string) =>
    request<DatasetDetail>(`/datasets/${encodeURIComponent(datasetId)}`),

  createDataset: (file: File) =>
    // Raw bytes plus the filename, rather than multipart: simpler on both
    // sides, and it streams a 50 MB upload without buffering a form envelope.
    request<DatasetSummary>(`/datasets?filename=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: file
    }),

  createDemo: () => request<DatasetSummary>("/demo", { method: "POST" }),

  createColumn: (datasetId: string, input: NewColumnInput) =>
    request<AiColumnDto>(`/datasets/${encodeURIComponent(datasetId)}/columns`, json(input)),

  deleteColumn: (datasetId: string, columnId: string) =>
    request<void>(columnBase(datasetId, columnId), { method: "DELETE" }),

  previewColumn: (datasetId: string, columnId: string, count: number) =>
    request<unknown>(`${columnBase(datasetId, columnId)}/preview`, json({ count })),

  runColumn: (datasetId: string, columnId: string) =>
    request<unknown>(`${columnBase(datasetId, columnId)}/run`, { method: "POST" }),

  getResults: (datasetId: string, columnId: string) =>
    request<ResultDto[]>(`${columnBase(datasetId, columnId)}/results`),

  getReport: (datasetId: string, columnId: string) =>
    request<ColumnReport>(`${columnBase(datasetId, columnId)}/report`),

  startAudit: (datasetId: string, columnId: string, count: number) =>
    request<{ sampled: number }>(`${columnBase(datasetId, columnId)}/audit`, json({ count })),

  putCorrection: (datasetId: string, columnId: string, rowId: string, value: string) =>
    request<unknown>(`${columnBase(datasetId, columnId)}/corrections/${encodeURIComponent(rowId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value })
    }),

  deleteCorrection: (datasetId: string, columnId: string, rowId: string) =>
    request<void>(`${columnBase(datasetId, columnId)}/corrections/${encodeURIComponent(rowId)}`, {
      method: "DELETE"
    }),

  improveInstruction: (datasetId: string, input: ImproveInstructionInput) =>
    request<ImproveInstructionResult>(
      `/datasets/${encodeURIComponent(datasetId)}/improve-instruction`,
      json(input)
    ),

  exportUrl: (datasetId: string, includeConfidence: boolean) =>
    `/api/datasets/${encodeURIComponent(datasetId)}/export?confidence=${includeConfidence ? "1" : "0"}`
}
