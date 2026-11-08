import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

export const firminoMcpPath = "/mcp"

/** How a provider reaches Firmino's MCP server: its loopback URL and the bearer token of this Engine run. */
export interface FirminoMcpConnection {
  url: string
  token: string
}

/** How long a provider waits for one Firmino tool call: a browser handoff waits up to 10 minutes for the user. Both providers default to about 60 s. */
export const firminoToolTimeoutMs = 11 * 60_000

/** The variable a provider process reads the bearer token from, so the token stays out of its config and arguments. */
export const firminoMcpTokenVariable = "FIRMINO_MCP_TOKEN"

/**
 * Answers one MCP request statelessly: a fresh server with every Firmino tool, so no session survives between calls.
 * The SDK loads on the first request, keeping it out of the Engine's boot.
 */
export async function handleFirminoMcp(request: Request, registerTools: (server: McpServer) => void) {
  const [{ McpServer }, { WebStandardStreamableHTTPServerTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/mcp.js"),
    import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"),
  ])
  const server = new McpServer({ name: "firmino", version: "0.1.0" })
  registerTools(server)
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
  await server.connect(transport)

  try {
    return await transport.handleRequest(request)
  } finally {
    await server.close()
  }
}
