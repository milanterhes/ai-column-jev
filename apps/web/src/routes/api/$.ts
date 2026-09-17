import { createFileRoute } from "@tanstack/react-router"
import { apiHandler } from "../../api/mount"

/**
 * Mounts the Effect `HttpApi` at `/api/*`. Every method is delegated to the
 * same Effect router, which does its own path/method matching. This runs
 * inside the Start server process, so the SPA and API share one port.
 */
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: apiHandler,
      POST: apiHandler,
      PUT: apiHandler,
      PATCH: apiHandler,
      DELETE: apiHandler,
      OPTIONS: apiHandler
    }
  }
})