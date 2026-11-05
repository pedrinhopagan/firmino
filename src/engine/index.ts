import { RPCHandler } from "@orpc/server/fetch"
import { join } from "node:path"
import { z } from "zod"
import { forwardedObservation } from "@src/shared/engine-ipc"
import { parse } from "@src/shared/parse"
import { createEngineRouter } from "./engine-router"
import { createEngineServer } from "./engine-server"
import { createObservationSystem } from "./observability"

const environment = parse(z.object({
  KOLEGA_ENGINE_TOKEN: z.string().min(1),
  KOLEGA_DATA_DIRECTORY: z.string().min(1),
  KOLEGA_DEVELOPMENT: z.enum(["true", "false"]),
}), process.env)
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

const server = createEngineServer({
  token: environment.KOLEGA_ENGINE_TOKEN,
  handler: new RPCHandler(createEngineRouter({ startedAt, observability, receiver })),
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

let stopping = false

async function shutdown() {
  if (stopping) {
    return
  }

  stopping = true
  await observability.span({ name: "engine.shutdown", attributes: { process: "engine", status: "stopped" } }, () => server.stop(true)).catch(() => {
    process.stderr.write("Bun Engine shutdown failed\n")
  })
  await observability.flush()
  process.exit(0)
}

process.on("SIGTERM", () => void shutdown())
process.on("disconnect", () => void shutdown())
