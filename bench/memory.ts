import { parseArgs } from "node:util"
import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { ContractRouterClient } from "@orpc/contract"
import { z } from "zod"
import { resolveAppProfile } from "@src/shared/app-profile"
import { providerId } from "@src/shared/conversation"
import type { engineContract } from "@src/shared/engine-contract"
import { parse } from "@src/shared/parse"
import { launchFirmino } from "./app"

const { values } = parseArgs({ args: Bun.argv.slice(2), options: { "user-data": { type: "string", default: ".firmino-bench" }, "settle-ms": { type: "string", default: "5000" }, "idle-ms": { type: "string", default: "20000" } } })
const settleMs = Number(values["settle-ms"])
const providers = providerId.options
const debuggingPort = resolveAppProfile(false).debuggingPort
const pageTargets = z.array(z.object({ type: z.string(), url: z.string(), webSocketDebuggerUrl: z.string() }))
const evaluation = z.object({ id: z.number(), result: z.object({ result: z.object({ value: z.unknown().optional() }), exceptionDetails: z.object({ text: z.string() }).optional() }) })
const engineConnection = z.object({ url: z.string(), token: z.string() })

/** Runs one expression in the chat Renderer over the dev profile's CDP port. */
async function inChatWindow(expression: string) {
  const page = parse(pageTargets, await (await fetch(`http://127.0.0.1:${debuggingPort}/json/list`)).json()).find((target) => target.type === "page" && target.url.endsWith("renderer/index.html"))

  if (!page) {
    throw new Error("No chat Renderer on the CDP port")
  }

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve) => {
    socket.onopen = resolve
  })
  const reply = new Promise<unknown>((resolve) => {
    socket.onmessage = (event) => resolve(JSON.parse(String(event.data)))
  })
  socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }))
  const { result } = parse(evaluation, await reply)
  socket.close()

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text)
  }

  return result.result.value
}

interface ProcessRow { pid: number; ppid: number; args: string }

function processRows() {
  return Bun.spawnSync(["ps", "-eo", "pid=,ppid=,args="]).stdout.toString().split("\n").filter(Boolean).map((line): ProcessRow => {
    const [pid = "0", ppid = "0", ...args] = line.trim().split(/\s+/)

    return { pid: Number(pid), ppid: Number(ppid), args: args.join(" ") }
  })
}

function descendants(rows: ProcessRow[], root: ProcessRow) {
  const family = [root]

  for (const member of family) {
    family.push(...rows.filter((row) => row.ppid === member.pid))
  }

  return family
}

async function pssMb(pid: number) {
  const rollup = await Bun.file(`/proc/${pid}/smaps_rollup`).text().catch(() => "")

  return Number(/^Pss:\s+(\d+) kB/m.exec(rollup)?.[1] ?? 0) / 1024
}

const chromiumRoles: [string, string][] = [["--type=gpu-process", "GPU"], ["--type=renderer", "Renderer"], ["--type=utility", "Utility (network, storage)"], ["--type=zygote", "Zygotes"]]

/** Which part of Firmino a process belongs to; provider children are its MCP servers and the commands it runs. */
function roles(mainPid: number) {
  const rows = processRows()
  const main = rows.find((row) => row.pid === mainPid)

  if (!main) {
    throw new Error("Firmino is not running")
  }

  const engine = rows.find((row) => row.ppid === mainPid && row.args.endsWith("firmino-engine"))
  const owned = new Map<number, string>(descendants(rows, main).map((row) => [row.pid, chromiumRoles.find(([flag]) => row.args.includes(flag))?.[1] ?? "Main"]))

  if (!engine) {
    return owned
  }

  owned.set(engine.pid, "Engine")

  for (const child of rows.filter((row) => row.ppid === engine.pid)) {
    const provider = providers.find((name) => child.args.includes(name)) ?? "Engine children"

    for (const row of descendants(rows, child)) {
      owned.set(row.pid, row.args.includes(provider) ? provider : `${provider} children`)
    }
  }

  return owned
}

async function sample(mainPid: number) {
  const totals: Record<string, number> = {}

  for (const [pid, role] of roles(mainPid)) {
    totals[role] = (totals[role] ?? 0) + await pssMb(pid)
  }

  return totals
}

function runningProviders(mainPid: number) {
  const running = new Set(roles(mainPid).values())

  return providers.filter((provider) => running.has(provider))
}

const app = await launchFirmino(values["user-data"], { FIRMINO_PROVIDER_IDLE_MS: values["idle-ms"] })
const states: Record<string, Record<string, number>> = {}

try {
  await app.waitFor("renderer.rpc")
  await Bun.sleep(settleMs)
  states["A window open"] = await sample(app.pid)

  const { url, token } = parse(engineConnection, await inChatWindow("window.desktop.getEngineConnection()"))
  const engine: ContractRouterClient<typeof engineContract> = createORPCClient(new RPCLink({ url, headers: { authorization: `Bearer ${token}` } }))

  await inChatWindow("window.desktop.closeWindow()").catch(() => {})
  await Bun.sleep(settleMs)
  states["B window closed"] = await sample(app.pid)

  for (const provider of providers) {
    // Each provider's default account has the provider's id.
    await engine.providers.choose({ account: provider })
    const events = await engine.conversation.events()
    await engine.conversation.send({ text: "Responda apenas: ok" })

    for await (const event of events) {
      if (event.type === "finished") {
        console.log(`${provider} turn ${event.outcome}${event.error ? `: ${event.error}` : ""}`)
        break
      }
    }
  }

  await Bun.sleep(settleMs)

  if (runningProviders(app.pid).length !== providers.length) {
    throw new Error(`Only ${runningProviders(app.pid).join(", ") || "no provider"} still running before sample C; raise --idle-ms`)
  }

  states["C providers running"] = await sample(app.pid)

  const deadline = Date.now() + Number(values["idle-ms"]) + 60_000

  while (runningProviders(app.pid).length > 0 && Date.now() < deadline) {
    await Bun.sleep(1_000)
  }

  await Bun.sleep(settleMs)
  states["D after idle shutdown"] = await sample(app.pid)
} finally {
  await app.quit()
}

const roleNames = [...new Set(Object.values(states).flatMap((totals) => Object.keys(totals)))]
const table = Object.fromEntries([...roleNames, "Total"].map((role) => [role, Object.fromEntries(Object.entries(states).map(([state, totals]) => [state, Math.round(role === "Total" ? Object.values(totals).reduce((sum, value) => sum + value, 0) : totals[role] ?? 0)]))]))

console.table(table)
