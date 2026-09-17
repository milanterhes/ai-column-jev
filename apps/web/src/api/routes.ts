import { DomainError } from "@app/spreadsheet/service"
import * as spreadsheet from "@app/spreadsheet/service"
import type { ManagedRuntime } from "effect"

/**
 * The HTTP surface.
 *
 * Deliberately a small hand-rolled router over the Effect services rather than
 * `HttpApi` groups: the domain needs multipart and raw-byte uploads, which the
 * schema-driven codec layer handles awkwardly, and this keeps the seam between
 * transport and domain explicit. The services themselves are pure Effect and
 * know nothing about HTTP.
 */

type Runtime = ManagedRuntime.ManagedRuntime<unknown, never>

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  })

const statusFor = (error: unknown): number => {
  if (error instanceof DomainError) return error.status
  if (error !== null && typeof error === "object" && "_tag" in error) {
    const tag = String((error as Record<string, unknown>)["_tag"])
    if (tag === "Unauthorized") return 401
  }
  return 500
}

const messageFor = (error: unknown): string => {
  if (error instanceof Error && error.message !== "") return error.message
  return "Something went wrong."
}

const segments = (pathname: string): string[] =>
  pathname.split("/").filter((part) => part !== "")

export const handleApi = async (
  request: Request,
  runtime: Runtime,
  currentUserId: string,
  pathname: string
): Promise<Response> => {
  const parts = segments(pathname)
  const method = request.method.toUpperCase()

  const run = (effect: unknown): Promise<Response> =>
    runtime
      .runPromise(effect as never)
      .then((value) => json(200, value ?? {}))
      .catch((error: unknown) => json(statusFor(error), { message: messageFor(error) }))

  const body = async <T>(): Promise<T> => (await request.json()) as T

  try {
    // /datasets
    if (parts[0] === "datasets" && parts.length === 1) {
      if (method === "GET") return await run(spreadsheet.listDatasets(currentUserId))
      if (method === "POST") {
        const url = new URL(request.url)
        const filename = url.searchParams.get("filename") ?? "upload.csv"
        const bytes = new Uint8Array(await request.arrayBuffer())
        return await run(spreadsheet.createDatasetFromCsv(currentUserId, filename, bytes))
      }
    }

    // /demo
    if (parts[0] === "demo" && parts.length === 1 && method === "POST") {
      return await run(spreadsheet.createDemoDataset(currentUserId))
    }

    // /datasets/:id
    if (parts[0] === "datasets" && parts.length === 2) {
      const datasetId = parts[1]!
      if (method === "GET") return await run(spreadsheet.getDataset(currentUserId, datasetId))
      if (method === "DELETE") return await run(spreadsheet.removeDataset(currentUserId, datasetId))
    }

    // /datasets/:id/export
    if (parts[0] === "datasets" && parts[2] === "export" && parts.length === 3 && method === "GET") {
      const url = new URL(request.url)
      const includeConfidence = url.searchParams.get("confidence") !== "0"
      const csv = (await runtime.runPromise(
        spreadsheet.exportCsv(currentUserId, parts[1]!, includeConfidence) as never
      )) as string
      return new Response(csv, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="enriched.csv"`
        }
      })
    }

    // /datasets/:id/improve-instruction
    if (parts[0] === "datasets" && parts[2] === "improve-instruction" && method === "POST") {
      const input = await body<{ instruction: string; type: string; headers: string[] }>()
      return await run(
        spreadsheet.improveInstruction({
          instruction: input.instruction,
          type: input.type,
          headers: Array.isArray(input.headers) ? input.headers : []
        })
      )
    }

    // /datasets/:id/columns
    if (parts[0] === "datasets" && parts[2] === "columns" && parts.length === 3) {
      if (method === "POST") {
        return await run(spreadsheet.createAiColumn(currentUserId, parts[1]!, await body()))
      }
    }

    // /datasets/:id/columns/:cid/...
    if (parts[0] === "datasets" && parts[2] === "columns" && parts.length >= 4) {
      const datasetId = parts[1]!
      const columnId = parts[3]!
      const tail = parts[4]

      if (tail === undefined && method === "DELETE") {
        return await run(spreadsheet.deleteAiColumn(currentUserId, datasetId, columnId))
      }
      if (tail === "preview" && method === "POST") {
        const input = await body<{ count?: number }>().catch(() => ({ count: 10 }))
        return await run(
          spreadsheet.previewColumn(currentUserId, datasetId, columnId, input.count ?? 10)
        )
      }
      if (tail === "run" && method === "POST") {
        return await run(spreadsheet.runColumn(currentUserId, datasetId, columnId))
      }
      if (tail === "results" && method === "GET") {
        return await run(spreadsheet.getResults(currentUserId, datasetId, columnId))
      }
      if (tail === "corrections" && parts.length === 6) {
        const rowId = parts[5]!
        if (method === "PUT") {
          const input = await body<{ value: string }>()
          return await run(
            spreadsheet.putCorrection(currentUserId, datasetId, columnId, rowId, input.value)
          )
        }
        if (method === "DELETE") {
          return await run(spreadsheet.removeCorrection(currentUserId, datasetId, columnId, rowId))
        }
      }
    }

    return json(404, { message: "Not found." })
  } catch (error) {
    return json(statusFor(error), { message: messageFor(error) })
  }
}
