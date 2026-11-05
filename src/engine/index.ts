import { RPCHandler } from "@orpc/server/fetch"
import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { z } from "zod"
import { forwardedObservation } from "@src/shared/engine-ipc"
import { parse } from "@src/shared/parse"
import { Conversation } from "./conversation"
import { openDatabase } from "./database"
import { createEngineRouter } from "./engine-router"
import { createEngineServer } from "./engine-server"
import { Google } from "./google/google"
import { handleKolegaMcp, kolegaMcpPath } from "./kolega-mcp"
import { createObservationSystem } from "./observability"
import { Routines } from "./routines"
import { Triggers } from "./triggers"
import { Whatsapp } from "./whatsapp/whatsapp"

const environment = parse(z.object({
  KOLEGA_ENGINE_TOKEN: z.string().min(1),
  KOLEGA_DATA_DIRECTORY: z.string().min(1),
  KOLEGA_DEVELOPMENT: z.enum(["true", "false"]),
  KOLEGA_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  KOLEGA_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
}), process.env)
// Providers inherit the Engine's environment and run any command the agent asks for; they reach Kolega only through the MCP token.
delete process.env.KOLEGA_ENGINE_TOKEN
delete process.env.KOLEGA_GOOGLE_CLIENT_ID
delete process.env.KOLEGA_GOOGLE_CLIENT_SECRET
// The build stops the binary from loading .env, but a shell that exported the build's names would still hand them on.
delete process.env.MAIN_VITE_GOOGLE_CLIENT_ID
delete process.env.MAIN_VITE_GOOGLE_CLIENT_SECRET
const startupStartedAt = performance.now()
const startedAt = new Date().toISOString()
const { observability, receiver } = createObservationSystem({
  appSessionId: crypto.randomUUID(),
  logDirectory: join(environment.KOLEGA_DATA_DIRECTORY, "logs"),
  development: environment.KOLEGA_DEVELOPMENT === "true",
})

process.on("message", (message) => {
  const forwarded = forwardedObservation.safeParse(message)

  if (!forwarded.success) {
    return
  }

  if (forwarded.data.type === "span") {
    receiver.span(forwarded.data.span)

    return
  }

  observability.event(forwarded.data)
})

const database = openDatabase(join(environment.KOLEGA_DATA_DIRECTORY, "kolega.sqlite"))
const mcpToken = randomBytes(32).toString("base64url")
const conversation = new Conversation(database, observability, {
  token: mcpToken,
  // Read when a provider session opens, after the server below is listening.
  get url() {
    return `http://127.0.0.1:${server.port}${kolegaMcpPath}`
  },
})
const routines = new Routines(database, conversation, observability)
// Read when a tool changes a Gatilho, after Google below exists.
const triggers = new Triggers(database, conversation, observability, () => google.watchMail())
const whatsapp = new Whatsapp(database, observability, triggers)
const google = new Google(database, observability, triggers, (url) => process.send?.({ type: "open-consent", url }), environment.KOLEGA_GOOGLE_CLIENT_ID ? { id: environment.KOLEGA_GOOGLE_CLIENT_ID, ...(environment.KOLEGA_GOOGLE_CLIENT_SECRET ? { secret: environment.KOLEGA_GOOGLE_CLIENT_SECRET } : {}) } : undefined)
// The router is built before the server listens: built after, it costs about 3 ms more of boot.
const server = createEngineServer({
  token: environment.KOLEGA_ENGINE_TOKEN,
  handler: new RPCHandler(createEngineRouter({ startedAt, observability, receiver, database, conversation, whatsapp, google })),
  mcp: { token: mcpToken, handle: (request) => handleKolegaMcp(request, (mcp) => {
    routines.registerTools(mcp)
    triggers.registerTools(mcp)
    whatsapp.registerTools(mcp)
    google.registerTools(mcp)
  }) },
})

receiver.span({
  name: "engine.startup",
  timestamp: startedAt,
  durationMs: performance.now() - startupStartedAt,
  outcome: "ok",
  traceId: crypto.randomUUID(),
  spanId: crypto.randomUUID(),
  attributes: { process: "engine", runtime: `Bun ${Bun.version}`, status: "ready" },
})
process.send?.({ type: "ready", port: server.port })
// After the ready message, so a linked WhatsApp loads Baileys and opens its socket outside the boot, and a connected Google starts its e-mail watch.
setImmediate(() => {
  if (stopping) {
    return
  }

  google.resume()
  whatsapp.resume().catch((error: unknown) => {
    observability.event({ name: "whatsapp.resumefailed", error })
  })
})

let stopping = false

async function shutdown() {
  if (stopping) {
    return
  }

  stopping = true
  routines.close()
  triggers.close()
  whatsapp.close()
  google.close()
  conversation.close()
  await observability.span({ name: "engine.shutdown", attributes: { process: "engine", status: "stopped" } }, () => server.stop(true)).catch(() => {
    process.stderr.write("Bun Engine shutdown failed\n")
  })
  database.close()
  await observability.flush()
  process.exit(0)
}

process.on("SIGTERM", () => void shutdown())
process.on("disconnect", () => void shutdown())
