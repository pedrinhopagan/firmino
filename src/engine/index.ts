import { RPCHandler } from "@orpc/server/fetch"
import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { z } from "zod"
import { type EngineTurnNotice, forwardedObservation } from "@src/shared/engine-ipc"
import { parse } from "@src/shared/parse"
import { Appointments } from "./appointments"
import { Browser } from "./browser"
import { Conversation, type QueuedTurnEnd } from "./conversation"
import { openDatabase } from "./database"
import { Discord } from "./discord"
import { createEngineRouter } from "./engine-router"
import { createEngineServer } from "./engine-server"
import { Google } from "./google/google"
import { handleFirminoMcp, firminoMcpPath } from "./firmino-mcp"
import { Memory } from "./memory"
import { createObservationSystem } from "./observability"
import { ProviderAccounts } from "./providers/provider-accounts"
import { Routines } from "./routines"
import { Triggers } from "./triggers"
import { Whatsapp } from "./whatsapp/whatsapp"

const providerIdleDefaultMs = 5 * 60_000
const environment = parse(z.object({
  FIRMINO_ENGINE_TOKEN: z.string().min(1),
  FIRMINO_DATA_DIRECTORY: z.string().min(1),
  FIRMINO_DEVELOPMENT: z.enum(["true", "false"]),
  FIRMINO_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  FIRMINO_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  FIRMINO_PROVIDER_IDLE_MS: z.coerce.number().int().positive().default(providerIdleDefaultMs),
}), process.env)
// Providers inherit the Engine's environment and run any command the agent asks for; they reach Firmino only through the MCP token.
delete process.env.FIRMINO_ENGINE_TOKEN
delete process.env.FIRMINO_GOOGLE_CLIENT_ID
delete process.env.FIRMINO_GOOGLE_CLIENT_SECRET
// The build stops the binary from loading .env, but a shell that exported the build's names would still hand them on.
delete process.env.MAIN_VITE_GOOGLE_CLIENT_ID
delete process.env.MAIN_VITE_GOOGLE_CLIENT_SECRET
const startupStartedAt = performance.now()
const startedAt = new Date().toISOString()
const { observability, receiver } = createObservationSystem({
  appSessionId: crypto.randomUUID(),
  logDirectory: join(environment.FIRMINO_DATA_DIRECTORY, "logs"),
  development: environment.FIRMINO_DEVELOPMENT === "true",
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

const database = openDatabase(join(environment.FIRMINO_DATA_DIRECTORY, "firmino.sqlite"))
const mcpToken = randomBytes(32).toString("base64url")
const noticePreviewLength = 100

function preview(text: string) {
  const line = text.replace(/\s+/g, " ").trim()

  if (line.length <= noticePreviewLength) {
    return line
  }

  return `${line.slice(0, noticePreviewLength - 1)}…`
}

function turnNotice(end: QueuedTurnEnd): EngineTurnNotice | undefined {
  if (end.outcome === "interrupted") {
    return undefined
  }

  const title = end.routine ? `Rotina "${end.routine}"` : `Gatilho "${end.trigger}"`

  if (end.outcome === "failed") {
    return { type: "turn-notice", title, body: `Erro: ${preview(end.error ?? "o agente falhou.")}` }
  }

  return { type: "turn-notice", title, body: preview(end.reply ?? "Terminou.") }
}

const openConsent = (url: string) => process.send?.({ type: "open-consent", url })
const accounts = new ProviderAccounts(database, observability, environment.FIRMINO_DATA_DIRECTORY, openConsent)
const memory = new Memory(database)
const conversation = new Conversation(database, observability, accounts, memory, {
  token: mcpToken,
  // Read when a provider session opens, after the server below is listening.
  get url() {
    return `http://127.0.0.1:${server.port}${firminoMcpPath}`
  },
}, environment.FIRMINO_PROVIDER_IDLE_MS, (end) => {
  const notice = turnNotice(end)

  if (notice) {
    process.send?.(notice)
  }
})
const routines = new Routines(database, conversation, observability)
const appointments = new Appointments(database, observability, () => process.send?.({ type: "appointment-alert" }))
// Read when a tool changes a Gatilho, after Google below exists.
const triggers = new Triggers(database, conversation, observability, () => google.watchMail())
const browser = new Browser(observability, triggers)
const whatsapp = new Whatsapp(database, observability, triggers)
const discord = new Discord(database, observability, triggers)
const google = new Google(database, observability, triggers, openConsent, environment.FIRMINO_GOOGLE_CLIENT_ID ? { id: environment.FIRMINO_GOOGLE_CLIENT_ID, ...(environment.FIRMINO_GOOGLE_CLIENT_SECRET ? { secret: environment.FIRMINO_GOOGLE_CLIENT_SECRET } : {}) } : undefined)
// The router is built before the server listens: built after, it costs about 3 ms more of boot.
const server = createEngineServer({
  token: environment.FIRMINO_ENGINE_TOKEN,
  handler: new RPCHandler(createEngineRouter({ startedAt, observability, receiver, database, accounts, conversation, memory, routines, appointments, triggers, browser, whatsapp, google, discord })),
  mcp: { token: mcpToken, handle: (request) => handleFirminoMcp(request, (mcp) => {
    memory.registerTools(mcp)
    routines.registerTools(mcp)
    appointments.registerTools(mcp)
    triggers.registerTools(mcp)
    whatsapp.registerTools(mcp)
    google.registerTools(mcp)
    discord.registerTools(mcp)
    browser.registerTools(mcp)
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

  appointments.start()
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
  appointments.close()
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
