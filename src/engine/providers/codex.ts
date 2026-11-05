import type { Subprocess } from "bun"
import { z } from "zod"
import type { ProviderStatus } from "@src/shared/conversation"
import { parse } from "@src/shared/parse"
import { kolegaMcpTokenVariable, kolegaToolTimeoutMs } from "../kolega-mcp"
import { errorMessage, kolegaInstructions, kolegaWorkingDirectory, type ProviderLaunch, type ProviderLogin, type ProviderSession, type ProviderSessionOptions, type TurnListener, type TurnResult } from "./provider"

const requestTimeoutMs = 20_000

const rpcMessage = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
})
const threadResponse = z.object({ thread: z.object({ id: z.string() }) })
const turnResponse = z.object({ turn: z.object({ id: z.string() }) })
const agentMessageDelta = z.object({ turnId: z.string(), itemId: z.string(), delta: z.string() })
/** The tool items Kolega shows while the agent works, each with the name to show. */
const toolLabels: Record<string, string> = { commandExecution: "terminal", fileChange: "edição de arquivos", webSearch: "busca na web" }
const itemStarted = z.object({
  item: z.union([
    z.object({ type: z.enum(["mcpToolCall", "dynamicToolCall"]), tool: z.string() }).transform((item) => item.tool),
    z.object({ type: z.string() }).transform((item) => toolLabels[item.type]),
  ]),
})
const turnCompleted = z.object({
  turn: z.object({
    id: z.string(),
    status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
    error: z.object({ message: z.string() }).nullable(),
  }),
})
const accountResponse = z.object({
  account: z.discriminatedUnion("type", [
    z.object({ type: z.literal("chatgpt"), email: z.string().nullable(), planType: z.string().nullable() }),
    z.object({ type: z.literal("apiKey") }),
    z.object({ type: z.literal("amazonBedrock") }),
  ]).nullable(),
})
const loginStarted = z.object({ authUrl: z.url() })
const loginCompleted = z.object({ success: z.boolean(), error: z.string().nullable().optional() })
const modelList = z.object({ data: z.array(z.object({ model: z.string(), displayName: z.string(), hidden: z.boolean(), isDefault: z.boolean() })) })
/** Codex wraps API failures as a JSON document inside the error message. */
const nestedApiError = z.object({ error: z.object({ message: z.string() }) })
const userMcpServersOff = z.object({ config: z.object({ mcp_servers: z.record(z.string(), z.unknown()).optional() }) })
  .transform(({ config }) => Object.fromEntries(Object.keys(config.mcp_servers ?? {}).map((name) => [name, { enabled: false }])))

const userSetupOffFlags = Object.entries({
  "features.apps": false,
  "features.plugins": false,
  "features.hooks": false,
  "features.memories": false,
  notify: [],
  "skills.include_instructions": false,
  project_doc_max_bytes: 0,
}).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`])

const runtimeMode = { cwd: kolegaWorkingDirectory, approvalPolicy: "never" } as const

/** `codex app-server` over stdio: newline-delimited JSON-RPC without the `jsonrpc` field. */
class CodexAppServer {
  readonly exited: Promise<void>
  private nextId = 0
  private readonly pending = new Map<number, PromiseWithResolvers<unknown>>()

  private constructor(readonly process: Subprocess<"pipe", "pipe", "ignore">, private readonly onNotification?: (method: string, params: unknown) => void) {
    this.exited = this.read()
  }

  static async start(launch: ProviderLaunch, onNotification?: (method: string, params: unknown) => void) {
    const server = new CodexAppServer(Bun.spawn([launch.executable, "app-server", ...userSetupOffFlags], { cwd: kolegaWorkingDirectory, env: { ...process.env, ...launch.env }, stdin: "pipe", stdout: "pipe", stderr: "ignore" }), onNotification)

    await server.request("initialize", { clientInfo: { name: "kolega", title: "Kolega", version: "0.1.0" }, capabilities: { experimentalApi: true } }).catch((error: unknown) => {
      server.process.kill()

      throw error
    })
    server.send({ method: "initialized" })

    return server
  }

  async request(method: string, params: unknown) {
    const id = ++this.nextId
    const response = Promise.withResolvers<unknown>()
    const timer = setTimeout(() => response.reject(new Error(`Codex did not answer ${method}`)), requestTimeoutMs)
    this.pending.set(id, response)
    this.send({ id, method, params })

    try {
      return await response.promise
    } finally {
      clearTimeout(timer)
      this.pending.delete(id)
    }
  }

  private send(message: object) {
    void this.process.stdin.write(`${JSON.stringify(message)}\n`)
    void this.process.stdin.flush()
  }

  private async read() {
    let buffer = ""

    for await (const chunk of this.process.stdout.pipeThrough(new TextDecoderStream())) {
      buffer += chunk
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines.filter(Boolean)) {
        try {
          this.route(rpcMessage.parse(JSON.parse(line)))
        } catch (error) {
          process.stderr.write(`Codex message ignored: ${errorMessage(error)}\n`)
        }
      }
    }

    for (const response of this.pending.values()) {
      response.reject(new Error("Codex closed unexpectedly"))
    }
  }

  private route(message: z.infer<typeof rpcMessage>) {
    if (message.id === undefined && message.method) {
      this.onNotification?.(message.method, message.params)

      return
    }

    if (message.method) {
      // Full-access mode never asks for approval; refuse any other server request so Codex does not wait on it.
      this.send({ id: message.id, error: { code: -32601, message: "Kolega does not handle this request" } })

      return
    }

    const response = typeof message.id === "number" ? this.pending.get(message.id) : undefined

    if (message.error) {
      response?.reject(new Error(message.error.message))

      return
    }

    response?.resolve(message.result)
  }
}

function turnError(message: string) {
  try {
    return nestedApiError.parse(JSON.parse(message)).error.message
  } catch {
    return message
  }
}

interface ActiveTurn {
  done: PromiseWithResolvers<TurnResult>
  listener: TurnListener
  turnId?: string
  itemId?: string
  interrupted: boolean
}

export class CodexSession implements ProviderSession {
  private server?: Promise<CodexAppServer>
  private live?: CodexAppServer
  private threadId?: string
  private defaultModel?: string
  private active?: ActiveTurn

  constructor(private readonly options: ProviderSessionOptions) {
    this.threadId = options.resume
  }

  async turn(...[input, listener]: Parameters<ProviderSession["turn"]>) {
    // Registered before Codex starts, so a Stop during startup is not lost.
    const active: ActiveTurn = { done: Promise.withResolvers(), listener, interrupted: false }
    this.active = active

    const started = await this.start(input, active).catch((error: unknown) => {
      this.active = undefined

      throw error
    })

    if (!started) {
      this.active = undefined

      return { outcome: "interrupted" } satisfies TurnResult
    }

    active.turnId = started

    if (active.interrupted) {
      await this.interrupt()
    }

    return await active.done.promise
  }

  /** Starts the turn once Codex is ready, unless it was interrupted meanwhile; returns the turn id. */
  private async start(input: Parameters<ProviderSession["turn"]>[0], active: ActiveTurn) {
    const server = await (this.server ??= this.open().catch((error: unknown) => {
      this.server = undefined

      throw error
    }))
    const model = input.model ?? await this.resolveDefaultModel(server)

    if (active.interrupted) {
      return undefined
    }

    const started = await server.request("turn/start", {
      ...runtimeMode,
      threadId: this.threadId,
      input: [{ type: "text", text: input.text, text_elements: [] }],
      model,
      sandboxPolicy: { type: "dangerFullAccess" },
    })

    return parse(turnResponse, started).turn.id
  }

  async interrupt() {
    const active = this.active

    if (!active || !this.server) {
      return
    }

    active.interrupted = true

    if (active.turnId) {
      await (await this.server).request("turn/interrupt", { threadId: this.threadId, turnId: active.turnId })
    }
  }

  close() {
    this.live?.process.kill()
  }

  private async open() {
    const { launch, mcp } = this.options
    const server = await CodexAppServer.start({ ...launch, env: { ...launch.env, [kolegaMcpTokenVariable]: mcp.token } }, (method, params) => this.handle(method, params))
    this.live = server
    void server.exited.then(() => this.lost(server))

    return await this.openThread(server).catch((error: unknown) => {
      this.live = undefined
      server.process.kill()

      throw error
    })
  }

  private async openThread(server: CodexAppServer) {
    const userServersOff = parse(userMcpServersOff, await server.request("config/read", { cwd: kolegaWorkingDirectory }))
    // Thread config overrides apply to resumed threads too; Codex reads the bearer token from its own environment.
    const config = { mcp_servers: { ...userServersOff, kolega: { url: this.options.mcp.url, bearer_token_env_var: kolegaMcpTokenVariable, tool_timeout_sec: kolegaToolTimeoutMs / 1000 } } }
    const thread = { ...runtimeMode, sandbox: "danger-full-access", developerInstructions: kolegaInstructions, config }
    const resumed = this.threadId ? await server.request("thread/resume", { ...thread, threadId: this.threadId }).catch(() => undefined) : undefined
    this.threadId = parse(threadResponse, resumed ?? await server.request("thread/start", thread)).thread.id
    this.options.onSession(this.threadId)

    return server
  }

  /** The model Codex's own config names may not be available to this account, so Kolega asks for the account's default. */
  private async resolveDefaultModel(server: CodexAppServer) {
    this.defaultModel ??= parse(modelList, await server.request("model/list", {})).data.find((model) => model.isDefault)?.model

    return this.defaultModel
  }

  private handle(method: string, params: unknown) {
    const active = this.active

    if (!active) {
      return
    }

    if (method === "item/agentMessage/delta") {
      const delta = parse(agentMessageDelta, params)

      if (active.itemId && active.itemId !== delta.itemId) {
        active.listener.delta("\n\n")
      }

      active.itemId = delta.itemId
      active.listener.delta(delta.delta)

      return
    }

    if (method === "item/started") {
      const tool = itemStarted.safeParse(params)

      if (tool.success && tool.data.item) {
        active.listener.tool(tool.data.item)
      }

      return
    }

    if (method !== "turn/completed") {
      return
    }

    const { turn } = parse(turnCompleted, params)

    if (active.turnId && active.turnId !== turn.id) {
      return
    }

    this.active = undefined
    active.done.resolve(this.result(turn, active.interrupted))
  }

  private result(turn: z.infer<typeof turnCompleted>["turn"], interrupted: boolean): TurnResult {
    if (turn.status === "failed") {
      return { outcome: "failed", error: turnError(turn.error?.message ?? "Codex failed the turn") }
    }

    if (interrupted || turn.status === "interrupted") {
      return { outcome: "interrupted" }
    }

    return { outcome: "completed" }
  }

  private lost(server: CodexAppServer) {
    if (this.live !== server) {
      return
    }

    this.live = undefined
    this.server = undefined
    this.active?.done.resolve({ outcome: "failed", error: "Codex closed unexpectedly" })
    this.active = undefined
  }
}

export async function codexStatus(launch: ProviderLaunch) {
  const server = await CodexAppServer.start(launch)

  try {
    const [accountRead, modelsRead] = await Promise.all([server.request("account/read", { refreshToken: false }), server.request("model/list", {})])
    const { account } = parse(accountResponse, accountRead)
    const models = parse(modelList, modelsRead).data.filter((model) => !model.hidden)
    const chatgpt = account?.type === "chatgpt" ? account : undefined

    return {
      installed: true,
      loggedIn: !!account,
      ...(chatgpt?.email ? { email: chatgpt.email } : {}),
      ...(chatgpt?.planType ? { plan: chatgpt.planType } : {}),
      models: models.map((model) => ({ id: model.model, label: model.displayName, isDefault: model.isDefault })),
    } satisfies Omit<ProviderStatus, "account">
  } finally {
    server.process.kill()
  }
}

/** ChatGPT sign-in through Codex's own flow: Codex listens on localhost for the browser's callback and saves auth.json in the account's home. */
export async function codexLogin(launch: ProviderLaunch): Promise<ProviderLogin> {
  const completed = Promise.withResolvers<void>()
  const server = await CodexAppServer.start(launch, (method, params) => {
    if (method !== "account/login/completed") {
      return
    }

    const result = parse(loginCompleted, params)

    if (result.success) {
      completed.resolve()

      return
    }

    completed.reject(new Error(result.error ?? "O ChatGPT não concluiu o login."))
  })
  void server.exited.then(() => completed.reject(new Error("O Codex fechou antes de concluir o login.")))
  const started = await server.request("account/login/start", { type: "chatgpt" }).catch((error: unknown) => {
    server.process.kill()

    throw error
  })

  return {
    url: parse(loginStarted, started).authUrl,
    done: completed.promise.finally(() => server.process.kill()),
    cancel: () => server.process.kill(),
  }
}
