import type { Subprocess } from "bun"
import { z } from "zod"
import type { ProviderStatus } from "@src/shared/conversation"
import { providerEffort } from "@src/shared/conversation"
import { parse } from "@src/shared/parse"
import { kolegaMcpTokenVariable, kolegaToolTimeoutMs } from "../kolega-mcp"
import { clipDetail, errorMessage, imagePath, kolegaInstructions, markLegacy, kolegaWorkingDirectory, type ProviderLaunch, type ProviderLogin, type ProviderSession, type ProviderSessionOptions, type TurnListener, type TurnResult, type WorkUpdate } from "./provider"

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
const stepStatus = { inProgress: "running", completed: "completed", failed: "failed", declined: "failed" } as const
const itemStatus = z.enum(["inProgress", "completed", "failed", "declined"]).transform((status) => stepStatus[status])
const textContent = z.array(z.looseObject({ text: z.string().optional() })).transform((items) => items.flatMap((item) => item.text ?? []).join("\n"))
/** The items Kolega shows in the work log; agent and user messages are the conversation itself. */
const workItem = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reasoning"), id: z.string(), summary: z.array(z.string()) }),
  z.object({ type: z.literal("commandExecution"), id: z.string(), command: z.string(), status: itemStatus, aggregatedOutput: z.string().nullable() }),
  z.object({ type: z.literal("fileChange"), id: z.string(), status: itemStatus, changes: z.array(z.object({ path: z.string(), diff: z.string() })) }),
  z.object({ type: z.literal("mcpToolCall"), id: z.string(), tool: z.string(), status: itemStatus, arguments: z.unknown(), result: z.object({ content: textContent }).nullable(), error: z.object({ message: z.string() }).nullable() }),
  z.object({ type: z.literal("dynamicToolCall"), id: z.string(), tool: z.string(), status: itemStatus, arguments: z.unknown(), contentItems: textContent.nullable() }),
  z.object({ type: z.literal("webSearch"), id: z.string(), query: z.string() }),
  z.object({ type: z.literal("imageView"), id: z.string(), path: z.string() }),
  z.object({ type: z.literal("imageGeneration"), id: z.string(), savedPath: z.string().optional() }),
])
const workItemEvent = z.object({ item: workItem })
const reasoningDelta = z.object({ itemId: z.string(), delta: z.string(), summaryIndex: z.int() })
const userInputRequest = z.object({
  itemId: z.string(),
  questions: z.array(z.object({
    id: z.string(),
    header: z.string(),
    question: z.string(),
    options: z.array(z.object({ label: z.string(), description: z.string() })).nullable(),
  })),
})
/** Codex runs each command through the user's shell, as `/usr/bin/bash -lc 'echo oi'`. */
const shellWrapper = /^(?:\S*\/)?(?:ba|z)?sh -l?c '([\s\S]*)'$/

function command(line: string) {
  const inner = shellWrapper.exec(line)?.[1]

  if (inner === undefined) {
    return line
  }

  return inner.replaceAll("'\\''", "'")
}

/** The text a click on the step reveals, when there is any. */
function detail(text: string | null | undefined) {
  if (!text?.trim()) {
    return {}
  }

  return { detail: clipDetail(text) }
}

/** A tool's input, as JSON, and what it answered. */
function toolText(input: unknown, output: string | null | undefined) {
  const shown = input && typeof input === "object" && Object.keys(input).length > 0 ? JSON.stringify(input, null, 2) : undefined

  return [shown, output].filter(Boolean).join("\n\n")
}

/** An MCP call answered with an image's path, as the screenshot tool does, shows the image instead of the path. */
function mcpStep(item: Extract<z.infer<typeof workItem>, { type: "mcpToolCall" }>): WorkUpdate {
  const output = item.error?.message ?? item.result?.content
  const image = output && imagePath(output)
  const step = { id: item.id, kind: "tool", status: item.status, title: item.tool } as const

  if (image) {
    return { ...step, ...detail(toolText(item.arguments, undefined)), image }
  }

  return { ...step, ...detail(toolText(item.arguments, output)) }
}

/** One Codex item as a step of the work; `settled` is the state of items that carry none. Reasoning without a summary has nothing to show. */
function workStep(item: z.infer<typeof workItem>, settled: "running" | "completed"): WorkUpdate | undefined {
  switch (item.type) {
    case "reasoning": {
      const text = item.summary.join("\n\n")

      if (!text) {
        return undefined
      }

      return { id: item.id, kind: "thinking", status: settled, text }
    }

    case "commandExecution":
      return { id: item.id, kind: "command", status: item.status, title: command(item.command), ...detail(item.aggregatedOutput) }

    case "fileChange":
      return { id: item.id, kind: "edit", status: item.status, title: item.changes.map((change) => change.path).join("\n"), ...detail(item.changes.map((change) => change.diff).join("\n")) }

    case "mcpToolCall":
      return mcpStep(item)

    case "dynamicToolCall":
      return { id: item.id, kind: "tool", status: item.status, title: item.tool, ...detail(toolText(item.arguments, item.contentItems)) }

    case "webSearch":
      return { id: item.id, kind: "web", status: settled, title: item.query }

    case "imageView":
      return { id: item.id, kind: "read", status: settled, title: item.path, image: item.path }

    case "imageGeneration":
      return { id: item.id, kind: "tool", status: settled, title: "image_generation", ...(item.savedPath ? { image: item.savedPath } : {}) }
  }
}

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
const modelList = z.object({ data: z.array(z.object({
  model: z.string(),
  // Codex names some models GPT-6.1-Sol and others GPT-6.1 Terra; Kolega shows them all as T3 Code does, GPT-6.1 Sol.
  displayName: z.string().transform((name) => name.replace(/(\d)-(?=[A-Z])/, "$1 ")),
  hidden: z.boolean(),
  isDefault: z.boolean(),
  supportedReasoningEfforts: z.array(z.object({ reasoningEffort: providerEffort })),
  defaultReasoningEffort: providerEffort,
})) })
/** Codex wraps API failures as a JSON document inside the error message. */
const nestedApiError = z.object({ error: z.object({ message: z.string() }) })
const userMcpServersOff = z.object({ config: z.object({ mcp_servers: z.record(z.string(), z.unknown()).optional() }) })
  .transform(({ config }) => Object.fromEntries(Object.keys(config.mcp_servers ?? {}).map((name) => [name, { enabled: false }])))

/** Turns off the user's own Codex setup, and turns on the ask tool outside Plan mode, as T3 Code's ask needs. */
const configFlags = Object.entries({
  "features.default_mode_request_user_input": true,
  "features.apps": false,
  "features.plugins": false,
  "features.hooks": false,
  "features.memories": false,
  notify: [],
  "skills.include_instructions": false,
  project_doc_max_bytes: 0,
}).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`])

const runtimeMode = { cwd: kolegaWorkingDirectory, approvalPolicy: "never" } as const

interface CodexHandlers {
  notification?: (method: string, params: unknown) => void
  /** Answers a request Codex sends; without an answer, Kolega refuses it. */
  request?: (method: string, params: unknown) => Promise<unknown> | undefined
}

/** `codex app-server` over stdio: newline-delimited JSON-RPC without the `jsonrpc` field. */
class CodexAppServer {
  readonly exited: Promise<void>
  private nextId = 0
  private readonly pending = new Map<number, PromiseWithResolvers<unknown>>()

  private constructor(readonly process: Subprocess<"pipe", "pipe", "ignore">, private readonly handlers: CodexHandlers) {
    this.exited = this.read()
  }

  static async start(launch: ProviderLaunch, handlers: CodexHandlers = {}) {
    const server = new CodexAppServer(Bun.spawn([launch.executable, "app-server", ...configFlags], { cwd: kolegaWorkingDirectory, env: { ...process.env, ...launch.env }, stdin: "pipe", stdout: "pipe", stderr: "ignore" }), handlers)

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
      this.handlers.notification?.(message.method, message.params)

      return
    }

    if (message.method) {
      const answer = this.handlers.request?.(message.method, message.params)

      // Full-access mode never asks for approval; refuse any other server request so Codex does not wait on it.
      if (!answer) {
        this.send({ id: message.id, error: { code: -32601, message: "Kolega does not handle this request" } })

        return
      }

      void answer.then((result) => this.send({ id: message.id, result }), (error: unknown) => this.send({ id: message.id, error: { code: -32603, message: errorMessage(error) } }))

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
  /** The reasoning summary streaming in, one text per summary part. */
  reasoning?: { id: string; parts: string[] }
}

export class CodexSession implements ProviderSession {
  private server?: Promise<CodexAppServer>
  private live?: CodexAppServer
  private threadId?: string
  private models?: z.infer<typeof modelList>["data"]
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
    const model = await this.resolveModel(server, input.model)

    if (active.interrupted) {
      return undefined
    }

    const started = await server.request("turn/start", {
      ...runtimeMode,
      threadId: this.threadId,
      input: [{ type: "text", text: input.text, text_elements: [] }],
      model: model.model,
      effort: input.effort ?? model.defaultReasoningEffort,
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
    const server = await CodexAppServer.start({ ...launch, env: { ...launch.env, [kolegaMcpTokenVariable]: mcp.token } }, { notification: (method, params) => this.handle(method, params), request: (method, params) => this.ask(method, params) })
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
  private async resolveModel(server: CodexAppServer, id?: string) {
    this.models ??= parse(modelList, await server.request("model/list", {})).data
    const model = this.models.find((candidate) => id ? candidate.model === id : candidate.isDefault)

    if (!model) {
      throw new Error(`Codex não oferece o modelo ${id ?? "padrão"}.`)
    }

    return model
  }

  private handle(method: string, params: unknown) {
    const active = this.active

    if (!active) {
      return
    }

    if (method === "item/agentMessage/delta") {
      this.write(active, parse(agentMessageDelta, params))

      return
    }

    if (method === "item/started" || method === "item/completed") {
      this.step(active, params, method === "item/completed" ? "completed" : "running")

      return
    }

    if (method === "item/reasoning/summaryTextDelta") {
      this.think(active, parse(reasoningDelta, params))

      return
    }

    if (method === "turn/completed") {
      this.complete(active, parse(turnCompleted, params).turn)
    }
  }

  /** Each agent message is a paragraph of the reply. */
  private write(active: ActiveTurn, delta: z.infer<typeof agentMessageDelta>) {
    if (active.itemId && active.itemId !== delta.itemId) {
      active.listener.delta("\n\n")
    }

    active.itemId = delta.itemId
    active.listener.delta(delta.delta)
  }

  private step(active: ActiveTurn, params: unknown, settled: "running" | "completed") {
    const event = workItemEvent.safeParse(params)
    const step = event.success && workStep(event.data.item, settled)

    if (step) {
      active.listener.work(step)
    }
  }

  /** The reasoning summary streams in parts; each part is a paragraph. */
  private think(active: ActiveTurn, delta: z.infer<typeof reasoningDelta>) {
    if (active.reasoning?.id !== delta.itemId) {
      active.reasoning = { id: delta.itemId, parts: [] }
    }

    active.reasoning.parts[delta.summaryIndex] = (active.reasoning.parts[delta.summaryIndex] ?? "") + delta.delta
    active.listener.work({ id: delta.itemId, kind: "thinking", status: "running", text: active.reasoning.parts.filter(Boolean).join("\n\n") })
  }

  private complete(active: ActiveTurn, turn: z.infer<typeof turnCompleted>["turn"]) {
    if (active.turnId && active.turnId !== turn.id) {
      return
    }

    this.active = undefined
    active.done.resolve(this.result(turn, active.interrupted))
  }

  /** Shows request_user_input's questions to the user and hands back the answers; dismissed questions get none. */
  private ask(method: string, params: unknown) {
    const active = this.active

    if (method !== "item/tool/requestUserInput" || !active) {
      return undefined
    }

    const request = parse(userInputRequest, params)
    const questions = request.questions.map((question) => ({ id: question.id, header: question.header, question: question.question, options: question.options ?? [], multiSelect: false }))

    return active.listener.ask(request.itemId, questions).then((answers) => ({
      answers: Object.fromEntries(Object.entries(answers ?? {}).map(([id, chosen]) => [id, { answers: chosen }])),
    }))
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
      models: markLegacy(models.map((model) => ({ id: model.model, label: model.displayName, isDefault: model.isDefault, efforts: model.supportedReasoningEfforts.map((option) => option.reasoningEffort), defaultEffort: model.defaultReasoningEffort }))),
    } satisfies Omit<ProviderStatus, "account">
  } finally {
    server.process.kill()
  }
}

/** ChatGPT sign-in through Codex's own flow: Codex listens on localhost for the browser's callback and saves auth.json in the account's home. */
export async function codexLogin(launch: ProviderLaunch): Promise<ProviderLogin> {
  const completed = Promise.withResolvers<void>()
  const server = await CodexAppServer.start(launch, { notification: (method, params) => {
    if (method !== "account/login/completed") {
      return
    }

    const result = parse(loginCompleted, params)

    if (result.success) {
      completed.resolve()

      return
    }

    completed.reject(new Error(result.error ?? "O ChatGPT não concluiu o login."))
  } })
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
