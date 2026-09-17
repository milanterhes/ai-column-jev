export type ColumnType = "yes_no" | "category" | "score"

export type ResultStatus =
  | "high_confidence"
  | "needs_review"
  | "unable_to_determine"
  | "failed"

export interface Label {
  name: string
  description?: string | undefined
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

export interface AiColumnDto {
  id: string
  name: string
  type: ColumnType
  instruction: string
  labels: Label[]
  needsReviewThreshold: number
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
}

export interface NewColumnInput {
  name: string
  type: ColumnType
  instruction: string
  labels: Label[]
  needsReviewThreshold?: number | undefined
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
