import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { setTimeout as sleep } from "node:timers/promises"
import { type EngineConnection, engineReadyMessage, type ForwardedObservation, type ForwardedObservationEvent } from "@src/shared/engine-ipc"
import { parse } from "@src/shared/parse"
import { inheritedEnvironment } from "./child-environment"

interface EngineProcessOptions {
  executable: string
  dataDirectory: string
  appVersion: string
  development: boolean
  onUnexpectedExit: (error: Error) => void
}

interface ChildExit {
  code: number | null
  signal: NodeJS.Signals | null
}

const readinessTimeoutMs = 10_000
const shutdownTimeoutMs = 5_000

/** Owns the Bun Engine child: starts it, hands out its connection and stops it with Main. */
export class EngineProcess {
  private child?: ChildProcess
  private exit?: Promise<ChildExit>
  private stopping = false
  private listening?: EngineConnection

  constructor(private readonly options: EngineProcessOptions) {}

  get connection() {
    if (!this.listening) {
      throw new Error("Bun Engine is not running")
    }

    return this.listening
  }

  async start(token: string) {
    if (this.child) {
      throw new Error("Bun Engine is already running")
    }

    const startedAt = new Date().toISOString()
    const started = performance.now()
    const child = spawn(this.options.executable, [], {
      env: {
        ...inheritedEnvironment(),
        KOLEGA_ENGINE_TOKEN: token,
        KOLEGA_DATA_DIRECTORY: this.options.dataDirectory,
        KOLEGA_DEVELOPMENT: this.options.development ? "true" : "false",
      },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    })
    const exit = new Promise<ChildExit>((resolve) => {
      child.once("close", (code, signal) => {
        resolve({ code, signal })

        const unexpected = !!this.listening && !this.stopping
        this.child = undefined
        this.exit = undefined
        this.listening = undefined

        if (unexpected) {
          this.options.onUnexpectedExit(new Error(`Bun Engine exited unexpectedly with code ${code} and signal ${signal}`))
        }
      })
    })
    this.child = child
    this.exit = exit
    this.stopping = false

    const ready = await Promise.race([
      once(child, "message", { signal: AbortSignal.timeout(readinessTimeoutMs) }).then(([message]) => parse(engineReadyMessage, message)),
      exit.then(({ code }) => {
        throw new Error(`Bun Engine exited before readiness with code ${code}`)
      }),
    ]).catch(async (error: unknown) => {
      await this.terminate(child, exit)

      throw new Error("Bun Engine did not become ready", { cause: error })
    })

    this.listening = { url: `http://127.0.0.1:${ready.port}/rpc`, token }
    await this.send({
      type: "span",
      span: {
        name: "main.startup",
        timestamp: startedAt,
        durationMs: performance.now() - started,
        outcome: "ok",
        traceId: crypto.randomUUID(),
        spanId: crypto.randomUUID(),
        attributes: { process: "main", status: "ready", version: this.options.appVersion },
      },
    })
  }

  async stop() {
    const child = this.child
    const exit = this.exit

    if (!child || !exit) {
      return
    }

    this.stopping = true
    await this.terminate(child, exit)
  }

  event(input: Omit<ForwardedObservationEvent, "type">) {
    return this.send({ type: "observation", ...input })
  }

  private send(message: ForwardedObservation) {
    const child = this.child

    if (!child?.connected) {
      return Promise.resolve()
    }

    return new Promise<void>((resolve) => {
      child.send(message, (error) => {
        if (error) {
          process.stderr.write(`Main observation forwarding failed: ${error.message}\n`)
        }

        resolve()
      })
    })
  }

  private async terminate(child: ChildProcess, exit: Promise<ChildExit>) {
    child.kill("SIGTERM")
    const timer = new AbortController()
    const timedOut = await Promise.race([
      exit.then(() => false),
      sleep(shutdownTimeoutMs, true, { signal: timer.signal }).catch(() => false),
    ]).finally(() => timer.abort())

    if (timedOut) {
      child.kill("SIGKILL")
      await exit
    }
  }
}
