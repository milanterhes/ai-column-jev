/**
 * CSV ingest.
 *
 * Encoding is **detected and transcoded, never rejected**: Excel on Windows
 * writes Windows-1252, which is a very common first upload, and failing it
 * would break the product's very first step. When we fall back we say so, and
 * the caller surfaces the assumption to the user. See the decision
 * "Dataset privacy and lifecycle".
 */

export interface IngestLimits {
  readonly maxBytes: number
  readonly maxRows: number
  readonly maxColumns: number
}

export const DEFAULT_LIMITS: IngestLimits = {
  maxBytes: 50 * 1024 * 1024,
  maxRows: 100_000,
  maxColumns: 256
}

export type CsvEncoding = "utf-8" | "windows-1252"

export interface ParsedCsv {
  readonly headers: ReadonlyArray<string>
  readonly rows: ReadonlyArray<ReadonlyArray<string>>
  /** What we assumed. Anything but `utf-8` is disclosed to the user. */
  readonly encoding: CsvEncoding
}

export class IngestError extends Error {
  readonly _tag = "IngestError" as const
  constructor(message: string) {
    super(message)
  }
}

/** Messages name the limit *and* the actual value — never a generic failure. */
const fail = (message: string): never => {
  throw new IngestError(message)
}

export const decodeBytes = (bytes: Uint8Array): { text: string; encoding: CsvEncoding } => {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" }
  } catch {
    // Windows-1252 never fails to decode, which is exactly why it is the
    // right fallback rather than a second strict decoder.
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" }
  }
}

/**
 * RFC 4180 field scanning: quoted fields, doubled quotes as an escape, and
 * newlines inside quotes. Hand-rolled rather than pulled in as a dependency,
 * because the surface we need is small and this keeps the boundary honest.
 */
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

  // A trailing line without a newline, but never a phantom empty final row.
  if (field.length > 0 || row.length > 0 || sawAnyChar) endRow()
  return rows
}

/** Normalise headers safely: trim, collapse blanks, and de-duplicate. */
export const normaliseHeaders = (raw: ReadonlyArray<string>): string[] => {
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

export const parseCsv = (bytes: Uint8Array, limits: IngestLimits = DEFAULT_LIMITS): ParsedCsv => {
  if (bytes.byteLength > limits.maxBytes) {
    fail(
      `This file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB. ` +
        `The limit is ${(limits.maxBytes / 1024 / 1024).toFixed(0)} MB.`
    )
  }

  const { text, encoding } = decodeBytes(bytes)
  const raw = scan(text)

  if (raw.length === 0) fail("This file has no rows.")

  const headerRow = raw[0]!
  if (headerRow.length > limits.maxColumns) {
    fail(`This file has ${headerRow.length} columns. The limit is ${limits.maxColumns}.`)
  }

  const headers = normaliseHeaders(headerRow)

  // Drop trailing rows that are entirely empty — a common artefact of exports.
  const body = raw
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ""))

  if (body.length > limits.maxRows) {
    fail(`This file has ${body.length} rows. The limit is ${limits.maxRows}.`)
  }

  const rows = body.map((row) => {
    const padded = [...row]
    while (padded.length < headers.length) padded.push("")
    return padded.slice(0, headers.length)
  })

  return { headers, rows, encoding }
}

/** Zip a parsed row back into a keyed object, preserving column order. */
export const toRowObject = (
  headers: ReadonlyArray<string>,
  row: ReadonlyArray<string>
): Record<string, string> => {
  const out: Record<string, string> = {}
  headers.forEach((header, index) => {
    out[header] = row[index] ?? ""
  })
  return out
}
