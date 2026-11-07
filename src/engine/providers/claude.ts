import { type PermissionResult, query, type Query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { join } from "node:path"
import { z } from "zod"
import { providerEffort, type ProviderStatus } from "@src/shared/conversation"
import { parse } from "@src/shared/parse"
import { kolegaMcpTokenVariable, kolegaToolTimeoutMs } from "../kolega-mcp"
import { clipDetail, errorMessage, imagePath, kolegaInstructions, markLegacy, kolegaWorkingDirectory, type ProviderLaunch, type ProviderLogin, type ProviderSession, type ProviderSessionOptions, type TurnListener, type TurnResult, type WorkUpdate } from "./provider"

const statusTimeoutMs = 10_000
const loginUrlTimeoutMs = 20_000
/** `claude auth login` prints the page to open when it cannot open a browser, which the Engine never can. */
const loginUrlPattern = /https:\/\/\S+\/oauth\/authorize\S+/

const authStatus = z.object({ loggedIn: z.boolean(), email: z.string().optional(), subscriptionType: z.string().nullable().optional(), configDirectory: z.string().optional(), orgId: z.string().optional() })
const claudeEffort = z.enum(["low", "medium", "high", "xhigh", "max"]).nullable()
const cachedDefaultEfforts = z.object({ catalog: z.object({ config: z.object({ models: z.array(z.object({
  id: z.string(),
  runtime: z.object({ default_effort: providerEffort.optional() }).optional(),
})) }) }) }).transform(({ catalog }) => new Map(catalog.config.models.flatMap((model) => model.runtime?.default_effort ? [[model.id, model.runtime.default_effort] as const] : [])))
const streamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("content_block_start"), content_block: z.object({ type: z.string(), id: z.string().optional(), name: z.string().optional() }) }),
  z.object({ type: z.literal("content_block_delta"), delta: z.object({ type: z.string(), text: z.string().optional(), thinking: z.string().optional() }) }),
])
const toolInput = z.looseObject({
  command: z.string().optional(),
  file_path: z.string().optional(),
  notebook_path: z.string().optional(),
  pattern: z.string().optional(),
  query: z.string().optional(),
  url: z.string().optional(),
})
const askedQuestions = z.object({ questions: z.array(z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
  multiSelect: z.boolean().optional(),
})) })
const toolResult = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z.union([z.string(), z.array(z.looseObject({ type: z.string(), text: z.string().optional() }))]).optional(),
  is_error: z.boolean().optional(),
})

/** How each Claude tool shows in the work log: its kind and the part of its input that names what it did. */
const toolSteps: Record<string, (input: z.infer<typeof toolInput>) => Pick<Extract<WorkUpdate, { title: string }>, "kind" | "title">> = {
  Bash: (input) => ({ kind: "command", title: input.command ?? "" }),
  Read: (input) => ({ kind: "read", title: input.file_path ?? "" }),
  Write: (input) => ({ kind: "edit", title: input.file_path ?? "" }),
  Edit: (input) => ({ kind: "edit", title: input.file_path ?? "" }),
  MultiEdit: (input) => ({ kind: "edit", title: input.file_path ?? "" }),
  NotebookEdit: (input) => ({ kind: "edit", title: input.notebook_path ?? "" }),
  Grep: (input) => ({ kind: "search", title: input.pattern ?? "" }),
  Glob: (input) => ({ kind: "search", title: input.pattern ?? "" }),
  WebSearch: (input) => ({ kind: "web", title: input.query ?? "" }),
  WebFetch: (input) => ({ kind: "web", title: input.url ?? "" }),
}

/** A tool call as a step of the work. AskUserQuestion is not one: its questions open through `canUseTool`. */
function toolStep(id: string, name: string, rawInput: unknown) {
  if (name === "AskUserQuestion") {
    return undefined
  }

  const input = toolInput.catch({}).parse(rawInput)
  const step = toolSteps[name]?.(input)
  const image = name === "Read" && input.file_path ? imagePath(input.file_path) : undefined

  if (step) {
    return { id, status: "running", ...step, ...(image ? { image } : {}) } satisfies WorkUpdate
  }

  // MCP tools arrive as mcp__<server>__<tool>; the tool name alone matches what Codex reports.
  const detail = rawInput && typeof rawInput === "object" && Object.keys(rawInput).length > 0 ? clipDetail(JSON.stringify(rawInput, null, 2)) : undefined

  return { id, status: "running", kind: "tool", title: name.replace(/^mcp__.+?__/, ""), ...(detail ? { detail } : {}) } satisfies WorkUpdate
}

/** The step a tool's result finishes: its output, and the image when the output is an image's path. */
function finishedStep(step: Extract<WorkUpdate, { title: string }>, result: z.infer<typeof toolResult>): WorkUpdate {
  const content = result.content ?? ""
  const output = clipDetail(typeof content === "string" ? content : content.flatMap((block) => block.text ?? []).join("\n"))
  const image = step.image ?? imagePath(output)
  // A read's output is the file itself, and an edit's only confirms it; the path already says what they did.
  const quiet = !result.is_error && (step.kind === "read" || step.kind === "edit")
  const detail = [step.kind === "tool" ? step.detail : undefined, quiet || image ? undefined : output].filter(Boolean).join("\n\n")

  return { ...step, status: result.is_error ? "failed" : "completed", ...(detail ? { detail } : {}), ...(image ? { image } : {}) }
}

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
  /** The thinking streaming in, until its block ends. */
  thinking?: { id: string; text: string }
  /** The tool calls still waiting for their result, by tool use id. */
  tools: Map<string, Extract<WorkUpdate, { title: string }>>
}

export class ClaudeSession implements ProviderSession {
  private live?: { query: Query; inbox: Inbox; model?: string }
  private sessionId?: string
  private active?: ActiveTurn

  constructor(private readonly options: ProviderSessionOptions) {
    this.sessionId = options.resume
  }

  async turn(...[input, listener]: Parameters<ProviderSession["turn"]>) {
    const effort = parse(claudeEffort, input.effort ?? null)
    const live = this.live ?? this.open(input.model)
    // Registered before the model switch, so a Stop while it runs is not lost.
    const active: ActiveTurn = { done: Promise.withResolvers(), listener, wrote: false, interrupted: false, tools: new Map() }
    this.active = active

    if (live.model !== input.model) {
      await live.query.setModel(input.model)
      live.model = input.model
    }

    await live.query.applyFlagSettings({ effortLevel: effort })

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
          // As T3 Code asks, so the work log can show what Claude is thinking.
          thinking: { type: "adaptive", display: "summarized" },
          settings: { autoMemoryEnabled: false, showThinkingSummaries: true },
          // Bypass mode still asks before AskUserQuestion, so its questions reach the user.
          canUseTool: (name, input, { toolUseID }) => this.permit(name, input, toolUseID),
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

    if (message.type === "assistant" && message.parent_tool_use_id === null) {
      this.started(active, message.message.content)

      return
    }

    if (message.type === "user" && message.parent_tool_use_id === null && Array.isArray(message.message.content)) {
      this.finished(active, message.message.content)

      return
    }

    if (message.type !== "result") {
      return
    }

    this.active = undefined
    active.done.resolve(this.result(message, active.interrupted))
  }

  /** Each full block Claude sends: a thinking block ends the thinking that streamed, and a tool call carries its whole input. */
  private started(active: ActiveTurn, blocks: Extract<SDKMessage, { type: "assistant" }>["message"]["content"]) {
    for (const block of blocks) {
      if (block.type === "thinking" && active.thinking) {
        active.listener.work({ id: active.thinking.id, kind: "thinking", status: "completed", text: block.thinking || active.thinking.text })
        active.thinking = undefined
      }

      if (block.type === "tool_use") {
        this.startTool(active, block.id, block.name, block.input)
      }
    }
  }

  private startTool(active: ActiveTurn, id: string, name: string, input: unknown) {
    const step = toolStep(id, name, input)

    if (step) {
      active.tools.set(id, step)
      active.listener.work(step)
    }
  }

  /** The results Claude hands back to itself finish their tool calls. */
  private finished(active: ActiveTurn, blocks: unknown[]) {
    for (const block of blocks) {
      const result = toolResult.safeParse(block)
      const step = result.success ? active.tools.get(result.data.tool_use_id) : undefined

      if (result.success && step) {
        active.tools.delete(result.data.tool_use_id)
        active.listener.work(finishedStep(step, result.data))
      }
    }
  }

  /** Answers AskUserQuestion with the user's choices; every other tool runs, as bypass mode allows. */
  private async permit(name: string, input: Record<string, unknown>, toolUseId: string): Promise<PermissionResult> {
    const active = this.active

    if (name !== "AskUserQuestion" || !active) {
      return { behavior: "allow", updatedInput: input }
    }

    // Claude answers by question text, so the text is each question's id.
    const questions = parse(askedQuestions, input).questions.map((question) => ({ ...question, id: question.question, multiSelect: question.multiSelect ?? false }))
    const answers = await active.listener.ask(toolUseId, questions)

    if (!answers) {
      return { behavior: "deny", message: "O usuário dispensou a pergunta sem responder." }
    }

    return { behavior: "allow", updatedInput: { ...input, answers: Object.fromEntries(questions.map((question) => [question.id, answers[question.id]?.join(", ") ?? ""])) } }
  }

  private stream(active: ActiveTurn, event: unknown) {
    const parsed = streamEvent.safeParse(event)

    if (!parsed.success) {
      return
    }

    if (parsed.data.type === "content_block_start") {
      const block = parsed.data.content_block

      // The full input comes with the assistant message; the step shows as soon as the call starts.
      if (block.type === "tool_use" && block.id && block.name) {
        this.startTool(active, block.id, block.name, {})
      }

      if (block.type === "text" && active.wrote) {
        active.listener.delta("\n\n")
      }

      return
    }

    const { delta } = parsed.data

    if (delta.type === "text_delta" && delta.text) {
      active.wrote = true
      active.listener.delta(delta.text)
    }

    if (delta.type === "thinking_delta" && delta.thinking) {
      active.thinking ??= { id: crypto.randomUUID(), text: "" }
      active.thinking.text += delta.thinking
      active.listener.work({ id: active.thinking.id, kind: "thinking", status: "running", text: active.thinking.text })
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
  const defaults = await claudeDefaultEfforts(auth)

  return {
    installed: true,
    loggedIn: auth.loggedIn,
    ...(auth.email ? { email: auth.email } : {}),
    ...(auth.subscriptionType ? { plan: auth.subscriptionType } : {}),
    models: models.map((model) => {
      const defaultEffort = defaults.get(model.id)

      return { ...model, ...(defaultEffort && model.efforts.includes(defaultEffort) ? { defaultEffort } : {}) }
    }),
  } satisfies Omit<ProviderStatus, "account">
}

/** The SDK lists supported levels; Claude's account-scoped catalog also names each model's default. */
async function claudeDefaultEfforts(auth: Pick<z.infer<typeof authStatus>, "configDirectory" | "orgId">) {
  if (!auth.configDirectory || !auth.orgId) {
    return new Map<string, string>()
  }

  const paths = await Array.fromAsync(new Bun.Glob(`${auth.orgId}-*-cc.json`).scan({ cwd: join(auth.configDirectory, "cache", "model-catalog"), absolute: true })).catch(() => [])
  const latest = paths.toSorted((a, b) => Bun.file(b).lastModified - Bun.file(a).lastModified)[0]

  if (!latest) {
    return new Map<string, string>()
  }

  // This cache is optional and may be absent or being replaced while Claude refreshes it.
  const parsed = await Bun.file(latest).json().then((value: unknown) => cachedDefaultEfforts.safeParse(value)).catch(() => undefined)

  if (!parsed?.success) {
    return new Map<string, string>()
  }

  return parsed.data
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

    return markLegacy(rows.filter((row) => row.value !== "default").map((row) => {
      const id = row.resolvedModel ?? row.value

      return { id, label: row.displayName, isDefault: id === standard, efforts: row.supportedEffortLevels ?? [] }
    }))
  } finally {
    models.close()
  }
}
