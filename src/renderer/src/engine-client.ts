import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { ContractRouterClient } from "@orpc/contract"
import type { engineContract } from "@src/shared/engine-contract"
import type { EngineConnection } from "@src/shared/engine-ipc"
import type { ExternalObservationSpan } from "@src/shared/observation"

/** RPC client for the Engine. Every call except the span report itself is measured as a `renderer.rpc` span in the Engine log. */
export function createEngineClient(connection: EngineConnection) {
  const link = new RPCLink({
    url: connection.url,
    headers: { authorization: `Bearer ${connection.token}` },
    async fetch(request, init, _options, path) {
      if (path.join(".") === "observations.rendererSpan") {
        return fetch(request, init)
      }

      const traceId = crypto.randomUUID()
      const spanId = crypto.randomUUID()
      const startedAt = performance.now()
      request.headers.set("x-trace-id", traceId)
      request.headers.set("x-parent-span-id", spanId)

      function report(span: Pick<ExternalObservationSpan, "outcome" | "attributes" | "error">) {
        void client.observations.rendererSpan({ name: "renderer.rpc", timestamp: new Date().toISOString(), durationMs: performance.now() - startedAt, traceId, spanId, ...span }).catch(() => {})
      }

      try {
        const response = await fetch(request, init)
        report({ outcome: response.ok ? "ok" : "error", attributes: { method: request.method, code: String(response.status) } })

        return response
      } catch (error) {
        if (!request.signal.aborted) {
          report({ outcome: "error", attributes: { method: request.method }, error: { type: "RequestError", message: "Request failed" } })
        }

        throw error
      }
    },
  })
  const client: ContractRouterClient<typeof engineContract> = createORPCClient(link)

  return client
}

export type EngineClient = ReturnType<typeof createEngineClient>
