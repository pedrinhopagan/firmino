import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { observation, type Observation } from "@src/shared/observation"
import { parse } from "@src/shared/parse"

type Span = Extract<Observation, { kind: "span" }>

const spanTimeoutMs = 30_000

/** The production build run as `electron .`, with its data in `userData`, until `quit`. */
export async function launchFirmino(userData: string, env?: Record<string, string>) {
  const directory = resolve(userData)
  const logPath = join(directory, "logs", "observations.jsonl")
  await mkdir(join(directory, "logs"), { recursive: true })
  const offset = await Bun.file(logPath).exists() ? (await Bun.file(logPath).text()).length : 0
  const { ELECTRON_RUN_AS_NODE: _, ...inherited } = process.env
  const spawnedAt = Date.now()
  const app = Bun.spawn(["node_modules/electron/dist/electron", "."], { env: { ...inherited, ...env, FIRMINO_USER_DATA: directory }, stdout: "ignore", stderr: "ignore" })

  async function observations() {
    const text = await Bun.file(logPath).exists() ? await Bun.file(logPath).text() : ""

    return text.slice(offset, text.lastIndexOf("\n") + 1).split("\n").filter(Boolean).map((line) => parse(observation, JSON.parse(line)))
  }

  async function spans() {
    return (await observations()).filter((item): item is Span => item.kind === "span")
  }

  return {
    pid: app.pid,
    spawnedAt,
    spans,
    async waitFor(name: string) {
      const deadline = Date.now() + spanTimeoutMs

      while (Date.now() < deadline) {
        const span = (await spans()).find((item) => item.name === name)

        if (span) {
          return span
        }

        await Bun.sleep(50)
      }

      throw new Error(`No ${name} span in ${spanTimeoutMs} ms`)
    },
    async quit() {
      app.kill("SIGTERM")
      await app.exited
    },
  }
}

export function spanStart(span: Span) {
  return new Date(span.timestamp).getTime()
}
