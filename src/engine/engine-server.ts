import type { RPCHandler } from "@orpc/server/fetch"
import { timingSafeEqual } from "node:crypto"
import type { EngineContext } from "./engine-router"
import { firminoMcpPath } from "./firmino-mcp"

const rpcPrefix = "/rpc"
const preflightHeaders = {
  "access-control-allow-headers": "authorization, content-type, x-trace-id, x-parent-span-id",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "600",
}

/** The packaged Renderer loads from file://, whose origin is "null"; the dev Renderer loads from the Vite server on loopback. */
function allowed(origin: string) {
  if (origin === "null") {
    return true
  }

  try {
    const url = new URL(origin)

    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")
  } catch {
    return false
  }
}

function withCors(response: Response, origin: string | null) {
  if (!origin) {
    return response
  }

  const headers = new Headers(response.headers)
  headers.set("access-control-allow-origin", origin)
  headers.set("vary", "Origin")

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function bearer(token: string) {
  const expected = Buffer.from(`Bearer ${token}`)

  return (request: Request) => {
    const given = Buffer.from(request.headers.get("authorization") ?? "")

    return given.length === expected.length && timingSafeEqual(given, expected)
  }
}

/**
 * Serves, on a random loopback port, the RPC router to requests carrying the token Main generated for this run,
 * and Firmino's MCP server to requests carrying the providers' own token.
 */
export function createEngineServer({ token, handler, mcp }: {
  token: string
  handler: Pick<RPCHandler<EngineContext>, "handle">
  mcp: { token: string; handle(request: Request): Promise<Response> }
}) {
  const authorized = bearer(token)
  const mcpAuthorized = bearer(mcp.token)

  async function rpc(request: Request) {
    if (!authorized(request)) {
      return new Response("Unauthorized", { status: 401 })
    }

    const traceId = request.headers.get("x-trace-id")
    const parentSpanId = request.headers.get("x-parent-span-id")
    const result = await handler.handle(request, {
      prefix: rpcPrefix,
      context: {
        ...(traceId ? { traceId } : {}),
        ...(parentSpanId ? { spanId: parentSpanId } : {}),
      },
    })

    if (!result.matched) {
      return new Response("Not found", { status: 404 })
    }

    return result.response
  }

  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, server) {
      const origin = request.headers.get("origin")

      if (origin && !allowed(origin)) {
        return new Response("Forbidden", { status: 403 })
      }

      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204, headers: preflightHeaders }), origin)
      }

      const { pathname } = new URL(request.url)

      if (pathname === firminoMcpPath) {
        // Providers call from their own process and send no Origin; a browser page that does was refused above.
        if (!mcpAuthorized(request)) {
          return new Response("Unauthorized", { status: 401 })
        }

        // A tool call answers only when it ends, and a browser handoff waits minutes for the user; Bun would drop it after 10 s idle.
        server.timeout(request, 0)

        return await mcp.handle(request)
      }

      if (pathname === rpcPrefix || pathname.startsWith(`${rpcPrefix}/`)) {
        return withCors(await rpc(request), origin)
      }

      return new Response("Not found", { status: 404 })
    },
  })
}
