import { query, type Query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import type { ProviderStatus } from "@src/shared/conversation"
import { kolegaMcpTokenVariable, kolegaToolTimeoutMs } from "../kolega-mcp"
import { errorMessage, kolegaInstructions, kolegaWorkingDirectory, type ProviderLaunch, type ProviderLogin, type ProviderSession, type ProviderSessionOptions, type TurnListener, type TurnResult } from "./provider"

const statusTimeoutMs = 10_000
const loginUrlTimeoutMs = 20_000
/** `claude auth login` prints the page to open when it cannot open a browser, which the Engine never can. */
const loginUrlPattern = /https:\/\/\S+\/oauth\/authorize\S+/

const authStatus = z.object({ loggedIn: z.boolean(), email: z.string().optional(), subscriptionType: z.string().nullable().optional() })
const streamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("content_block_start"), content_block: z.object({ type: z.string(), name: z.string().optional() }) }),
  z.object({ type: z.literal("content_block_delta"), delta: z.object({ type: z.string(), text: z.string().optional() }) }),
])

/** User messages for a Claude query that stays open across turns. */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private readonly queued: SDKUserMessage[] = []
  private wake?: () => void

  push(text: string) {
    this.queued.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null })
    this.wake?.()
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const next = this.queued.shift()

      if (next) {
        yield next
        continue
      }

      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
    }
  }
}

interface ActiveTurn {
  done: PromiseWithResolvers<TurnResult>
  listener: TurnListener
  wrote: boolean
  interrupted: boolean
}

export class ClaudeSession implements ProviderSession {
  private live?: { query: Query; inbox: Inbox; model?: string }
  private sessionId?: string
  private active?: ActiveTurn

  constructor(private readonly options: ProviderSessionOptions) {
    this.sessionId = options.resume
  }

  async turn(...[input, listener]: Parameters<ProviderSession["turn"]>) {
    const live = this.live ?? this.open(input.model)
    // Registered before the model switch, so a Stop while it runs is not lost.
    const active: ActiveTurn = { done: Promise.withResolvers(), listener, wrote: false, interrupted: false }
    this.active = active

    if (live.model !== input.model) {
      await live.query.setModel(input.model)
      live.model = input.model
    }

    if (active.interrupted) {
      this.active = undefined

      return { outcome: "interrupted" } satisfies TurnResult
    }

    live.inbox.push(input.text)

    return await active.done.promise
  }

  async interrupt() {
    if (!this.active || !this.live) {
      return
    }

    this.active.interrupted = true
    await this.live.query.interrupt()
  }

  close() {
    this.live?.query.close()
  }

  private open(model?: string) {
    const inbox = new Inbox()
    const live = {
      inbox,
      ...(model ? { model } : {}),
      query: query({
        prompt: inbox,
        options: {
          pathToClaudeCodeExecutable: this.options.launch.executable,
          cwd: kolegaWorkingDirectory,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          includePartialMessages: true,
          systemPrompt: { type: "preset", preset: "claude_code", append: kolegaInstructions },
          settingSources: [],
          strictMcpConfig: true,
          skills: [],
          settings: { autoMemoryEnabled: false },
          // Claude expands the variable itself, so the token stays out of the --mcp-config argument other users can read.
          env: { ...process.env, ...this.options.launch.env, [kolegaMcpTokenVariable]: this.options.mcp.token, MCP_TOOL_TIMEOUT: String(kolegaToolTimeoutMs) },
          mcpServers: { kolega: { type: "http", url: this.options.mcp.url, headers: { authorization: `Bearer \${${kolegaMcpTokenVariable}}` } } },
          ...(model ? { model } : {}),
          ...(this.sessionId ? { resume: this.sessionId } : {}),
        },
      }),
    }
    this.live = live
    void this.read(live)

    return live
  }

  private async read(live: NonNullable<ClaudeSession["live"]>) {
    const resuming = !!this.sessionId
    let initialized = false
    const error = await (async () => {
      for await (const message of live.query) {
        initialized ||= message.type === "system" && message.subtype === "init"
        this.handle(message)
      }

      return "Claude closed unexpectedly"
    })().catch(errorMessage)

    if (this.live === live) {
      this.live = undefined
    }

    // A saved session Claude can no longer open would fail every turn; the next turn starts a new one.
    if (resuming && !initialized) {
      this.sessionId = undefined
      this.options.onSession(undefined)
    }

    this.active?.done.resolve({ outcome: "failed", error })
    this.active = undefined
  }

  private handle(message: SDKMessage) {
    if (message.type === "system" && message.subtype === "init" && message.session_id !== this.sessionId) {
      this.sessionId = message.session_id
      this.options.onSession(message.session_id)
    }

    const active = this.active

    if (!active) {
      return
    }

    if (message.type === "stream_event" && message.parent_tool_use_id === null) {
      this.stream(active, message.event)

      return
    }

    if (message.type !== "result") {
      return
    }

    this.active = undefined
    active.done.resolve(this.result(message, active.interrupted))
  }

  private stream(active: ActiveTurn, event: unknown) {
    const parsed = streamEvent.safeParse(event)

    if (!parsed.success) {
      return
    }

    if (parsed.data.type === "content_block_start") {
      const block = parsed.data.content_block

      if (block.type === "tool_use" && block.name) {
        // MCP tools arrive as mcp__<server>__<tool>; the tool name alone matches what Codex reports.
        active.listener.tool(block.name.replace(/^mcp__.+?__/, ""))
      }

      if (block.type === "text" && active.wrote) {
        active.listener.delta("\n\n")
      }

      return
    }

    if (parsed.data.delta.type === "text_delta" && parsed.data.delta.text) {
      active.wrote = true
      active.listener.delta(parsed.data.delta.text)
    }
  }

  private result(message: Extract<SDKMessage, { type: "result" }>, interrupted: boolean): TurnResult {
    if (interrupted) {
      return { outcome: "interrupted" }
    }

    if (message.subtype !== "success") {
      return { outcome: "failed", error: message.errors.join("\n") || message.subtype }
    }

    if (message.is_error) {
      return { outcome: "failed", error: message.result }
    }

    return { outcome: "completed" }
  }
}

export async function claudeStatus(launch: ProviderLaunch) {
  const child = Bun.spawn([launch.executable, "auth", "status", "--json"], { env: { ...process.env, ...launch.env }, stdout: "pipe", stderr: "ignore", timeout: statusTimeoutMs })
  const [auth, models] = await Promise.all([new Response(child.stdout).text().then((text) => authStatus.parse(JSON.parse(text))), claudeModels(launch)])

  return {
    installed: true,
    loggedIn: auth.loggedIn,
    ...(auth.email ? { email: auth.email } : {}),
    ...(auth.subscriptionType ? { plan: auth.subscriptionType } : {}),
    models,
  } satisfies Omit<ProviderStatus, "account">
}

/** The sign-in page the CLI prints. The output keeps draining afterwards, so the CLI never writes to a closed pipe. */
function loginUrl(output: ReadableStream<Uint8Array<ArrayBuffer>>) {
  const found = Promise.withResolvers<string>()
  let printed = ""

  void (async () => {
    for await (const chunk of output.pipeThrough(new TextDecoderStream())) {
      printed += chunk
      const url = loginUrlPattern.exec(printed)?.[0]

      if (url) {
        found.resolve(url)
      }
    }

    found.reject(new Error(printed.trim() || "O Claude não mostrou a página de login."))
  })()

  return found.promise
}

/** Subscription sign-in through `claude auth login`: the page shows a code, and the CLI saves the login in the account's CLAUDE_CONFIG_DIR once it reads that code. */
export async function claudeLogin(launch: ProviderLaunch): Promise<ProviderLogin> {
  const child = Bun.spawn([launch.executable, "auth", "login", "--claudeai"], { cwd: kolegaWorkingDirectory, env: { ...process.env, ...launch.env }, stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => child.kill(), loginUrlTimeoutMs)
  const url = await loginUrl(child.stdout).finally(() => clearTimeout(timer)).catch((error: unknown) => {
    child.kill()

    throw error
  })

  return {
    url,
    done: child.exited.then(async () => {
      if (!(await claudeStatus(launch)).loggedIn) {
        throw new Error((await new Response(child.stderr).text()).trim() || "O Claude não concluiu o login.")
      }
    }),
    submitCode: (code) => {
      void child.stdin.write(`${code}\n`)
      void child.stdin.flush()
    },
    cancel: () => child.kill(),
  }
}

/** The models this Claude Code offers, as its own /model menu lists them, each under the full id its alias resolves to. */
async function claudeModels(launch: ProviderLaunch) {
  const models = query({ prompt: new Inbox(), options: { pathToClaudeCodeExecutable: launch.executable, cwd: kolegaWorkingDirectory, env: { ...process.env, ...launch.env }, settingSources: [] } })

  try {
    const rows = await models.supportedModels()
    const standard = rows.find((row) => row.value === "default")?.resolvedModel

    return rows.filter((row) => row.value !== "default").map((row) => {
      const id = row.resolvedModel ?? row.value

      return { id, label: row.displayName, isDefault: id === standard }
    })
  } finally {
    models.close()
  }
}
