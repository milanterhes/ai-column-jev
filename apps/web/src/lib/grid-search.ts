import type { ResultStatus } from "../api/client.ts"
import { isStatus } from "./format.ts"

export interface GridSearch {
  q?: string | undefined
  status?: string | undefined
  hide?: string | undefined
  sort?: string | undefined
  dir?: "asc" | "desc" | undefined
  by?: "value" | "confidence" | undefined
}

export type StatusFilter = Record<string, ResultStatus[]>

export const parseStatusFilter = (raw: string | undefined): StatusFilter => {
  if (raw === undefined || raw === "") return {}
  const out: StatusFilter = {}
  for (const chunk of raw.split(",")) {
    const [key, values] = chunk.split(":")
    if (key === undefined || values === undefined || key === "") continue
    const statuses = values.split("+").filter(isStatus)
    if (statuses.length > 0) out[key] = statuses
  }
  return out
}

export const serializeStatusFilter = (filter: StatusFilter): string | undefined => {
  const parts = Object.entries(filter)
    .filter(([, statuses]) => statuses.length > 0)
    .map(([key, statuses]) => `${key}:${statuses.join("+")}`)
  return parts.length === 0 ? undefined : parts.join(",")
}

export const parseHidden = (raw: string | undefined): Record<string, boolean> => {
  if (raw === undefined || raw === "") return {}
  const out: Record<string, boolean> = {}
  for (const key of raw.split(",")) {
    if (key !== "") out[key] = false
  }
  return out
}

export const serializeHidden = (visibility: Record<string, boolean>): string | undefined => {
  const parts = Object.entries(visibility)
    .filter(([, visible]) => !visible)
    .map(([key]) => key)
  return parts.length === 0 ? undefined : parts.join(",")
}
