import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

export const kolegaMcpPath = "/mcp"

/** How a provider reaches Kolega's MCP server: its loopback URL and the bearer token of this Engine run. */
export interface KolegaMcpConnection {
  url: string
  token: string
}

/** The variable a provider process reads the bearer token from, so the token stays out of its config and arguments. */
export const kolegaMcpTokenVariable = "KOLEGA_MCP_TOKEN"

/**
 * Answers one MCP request statelessly: a fresh server with every Kolega tool, so no session survives between calls.
 * The SDK loads on the first request, keeping it out of the Engine's boot.
 */
export async function handleKolegaMcp(request: Request, registerTools: (server: McpServer) => void) {
  const [{ McpServer }, { WebStandardStreamableHTTPServerTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/mcp.js"),
    import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"),
  ])
  const server = new McpServer({ name: "kolega", version: "0.1.0" })
  registerTools(server)
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
  await server.connect(transport)

  try {
    return await transport.handleRequest(request)
  } finally {
    await server.close()
  }
}
