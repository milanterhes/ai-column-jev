export interface CsvLimits {
  maxBytes: number
  maxRows: number
  maxColumns: number
}

export const CSV_LIMITS: CsvLimits = {
  maxBytes: 50 * 1024 * 1024,
  maxRows: 100_000,
  maxColumns: 256
}

export type CsvEncoding = "utf-8" | "windows-1252"

export interface ParsedCsv {
  filename: string
  headers: string[]
  rows: string[][]
  encoding: CsvEncoding
}

export class CsvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CsvError"
  }
}

const decodeBytes = (bytes: Uint8Array): { text: string; encoding: CsvEncoding } => {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" }
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" }
  }
}

const scan = (text: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  let index = 0
  let sawAnyChar = false

  const endField = () => {
    row.push(field)
    field = ""
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
    sawAnyChar = false
  }

  while (index < text.length) {
    const char = text[index]!

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        inQuotes = false
        index += 1
        continue
      }
      field += char
      index += 1
      continue
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true
      index += 1
      continue
    }
    if (char === ",") {
      endField()
      index += 1
      continue
    }
    if (char === "\r") {
      if (text[index + 1] === "\n") index += 1
      endRow()
      index += 1
      continue
    }
    if (char === "\n") {
      endRow()
      index += 1
      continue
    }
    field += char
    sawAnyChar = true
    index += 1
  }

  if (field.length > 0 || row.length > 0 || sawAnyChar) endRow()
  return rows
}

const normaliseHeaders = (raw: string[]): string[] => {
  const used = new Map<string, number>()
  return raw.map((header, position) => {
    const trimmed = header.trim().replace(/^\uFEFF/, "")
    const base = trimmed === "" ? `column_${position + 1}` : trimmed
    const seen = used.get(base)
    if (seen === undefined) {
      used.set(base, 1)
      return base
    }
    used.set(base, seen + 1)
    return `${base}_${seen + 1}`
  })
}

const parseBytes = (bytes: Uint8Array, filename: string, limits: CsvLimits): ParsedCsv => {
  if (bytes.byteLength > limits.maxBytes) {
    throw new CsvError(
      `This file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB. The limit is ` +
        `${(limits.maxBytes / 1024 / 1024).toFixed(0)} MB.`
    )
  }

  const { text, encoding } = decodeBytes(bytes)
  const raw = scan(text)
  if (raw.length === 0) throw new CsvError("This file has no rows.")

  const headerRow = raw[0]!
  if (headerRow.length > limits.maxColumns) {
    throw new CsvError(`This file has ${headerRow.length} columns. The limit is ${limits.maxColumns}.`)
  }

  const headers = normaliseHeaders(headerRow)
  const body = raw.slice(1).filter((row) => row.some((cell) => cell.trim() !== ""))

  if (body.length > limits.maxRows) {
    throw new CsvError(`This file has ${body.length} rows. The limit is ${limits.maxRows}.`)
  }

  const rows = body.map((row) => {
    const padded = [...row]
    while (padded.length < headers.length) padded.push("")
    return padded.slice(0, headers.length)
  })

  return { filename, headers, rows, encoding }
}

export const parseCsvFile = async (file: File, limits: CsvLimits = CSV_LIMITS): Promise<ParsedCsv> => {
  const buffer = await file.arrayBuffer()
  return parseBytes(new Uint8Array(buffer), file.name, limits)
}

export const rowObject = (headers: string[], row: string[]): Record<string, string> => {
  const out: Record<string, string> = {}
  headers.forEach((header, index) => {
    out[header] = row[index] ?? ""
  })
  return out
}
