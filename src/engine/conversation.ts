import { EventPublisher, ORPCError } from "@orpc/server"
import type { ConversationEvent, ConversationMessage, ProviderChoice, ProviderId, ProviderStatus, TurnOutcome } from "@src/shared/conversation"
import { providerId } from "@src/shared/conversation"
import type { KolegaDatabase } from "./database"
import type { KolegaMcpConnection } from "./kolega-mcp"
import type { Observability } from "./observability"
import { ClaudeSession, claudeStatus } from "./providers/claude"
import { CodexSession, codexStatus } from "./providers/codex"
import { errorMessage, type ProviderSession, type ProviderSessionOptions, type TurnResult } from "./providers/provider"
import { localMinute } from "./routines"

const speakers = { user: "Usuário", assistant: "Kolega" }

/** A turn Kolega starts on its own: a Rotina's prompt, or a Gatilho's instruction with the messages that fired it. */
export interface QueuedTurn {
  text: string
  routine?: string
  trigger?: string
}

type Framed = Pick<ConversationMessage, "role" | "text" | "routine" | "trigger">

function speaker(message: Framed) {
  if (message.routine) {
    return "Rotina"
  }

  if (message.trigger) {
    return "Gatilho"
  }

  return speakers[message.role]
}

/** How a message reads to the provider: a Rotina's or a Gatilho's message says which one sent it. */
function framed(message: Framed) {
  if (message.routine) {
    return `Rotina "${message.routine}" disparou agora:\n\n${message.text}`
  }

  if (message.trigger) {
    return `Gatilho "${message.trigger}" disparou agora; esta mensagem não foi escrita pelo usuário:\n\n${message.text}`
  }

  return message.text
}

/** Hands a provider the turns another provider answered, so switching keeps the context. */
function withTranscript(unseen: Framed[], text: string) {
  if (unseen.length === 0) {
    return text
  }

  const transcript = unseen.map((message) => `${speaker(message)}: ${framed(message)}`).join("\n\n")

  return `Mensagens anteriores desta conversa, que você ainda não viu:\n\n${transcript}\n\nMensagem atual:\n\n${text}`
}

/** The user's local date, time and timezone, so the agent can place "daqui a 2 minutos" and "amanhã às 9h". */
function clock(now: Date) {
  return `Agora: ${localMinute(now)}, ${now.toLocaleDateString("pt-BR", { weekday: "long" })} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`
}

const providers = {
  codex: { status: codexStatus, open: (options: ProviderSessionOptions) => new CodexSession(options) },
  claude: { status: claudeStatus, open: (options: ProviderSessionOptions) => new ClaudeSession(options) },
}

/** The one conversation Kolega keeps: its messages, the provider that answers and the turn in progress. */
export class Conversation {
  private readonly sessions = new Map<ProviderId, ProviderSession>()
  private readonly publisher = new EventPublisher<{ event: ConversationEvent }>({ maxBufferedEvents: Number.POSITIVE_INFINITY })
  private running?: { session: ProviderSession; reply: string; tool?: string; started: ConversationEvent }
  /** Settles when the turn in progress ends. */
  private idle: Promise<TurnOutcome> = Promise.resolve("completed")

  constructor(private readonly database: KolegaDatabase, private readonly observability: Observability, private readonly mcp: KolegaMcpConnection) {}

  send(text: string) {
    if (this.running) {
      throw new ORPCError("TURN_RUNNING")
    }

    return this.start({ text }).message
  }

  /**
   * Runs a Rotina or Gatilho turn once the turn in progress ends; resolves with its outcome, or with nothing when `claim` skips it.
   * `claim` runs in the same tick the turn starts, so no user message starts in between and the turn it returns is current.
   */
  async runQueued(claim: () => QueuedTurn | undefined) {
    while (this.running) {
      await this.idle
    }

    const turn = claim()

    if (!turn) {
      return undefined
    }

    return await this.start(turn).finished
  }

  async interrupt() {
    await this.running?.session.interrupt()
  }

  async *events(signal?: AbortSignal) {
    const live = this.publisher.subscribe("event", { signal, maxBufferedEvents: Number.POSITIVE_INFINITY })
    // Taken in the same tick as the subscription, so the snapshot and the live events neither overlap nor leave a gap.
    const snapshot: ConversationEvent[] = this.running ? [this.running.started, { type: "delta", text: this.running.reply }, ...(this.running.tool ? [{ type: "tool" as const, name: this.running.tool }] : [])] : []

    yield* snapshot
    yield* live
  }

  active(): ProviderChoice {
    const provider = providerId.catch("codex").parse(this.database.state.get("provider"))
    const model = this.database.state.get(`model.${provider}`)

    return { provider, ...(model ? { model } : {}) }
  }

  choose(choice: ProviderChoice) {
    if (this.running) {
      throw new ORPCError("TURN_RUNNING")
    }

    this.database.state.set("provider", choice.provider)
    this.database.state.set(`model.${choice.provider}`, choice.model)

    return this.active()
  }

  async status() {
    return await Promise.all(Object.entries(providers).map(([provider, adapter]) => this.observability.span({ name: "provider.status", attributes: { provider } }, () => adapter.status()).catch((): ProviderStatus => ({
      provider: providerId.parse(provider),
      installed: true,
      loggedIn: false,
      models: [],
    }))))
  }

  close() {
    for (const session of this.sessions.values()) {
      session.close()
    }
  }

  private session(provider: ProviderId) {
    const existing = this.sessions.get(provider)

    if (existing) {
      return existing
    }

    const executable = Bun.which(provider)

    if (!executable) {
      throw new ORPCError("PRECONDITION_FAILED", { message: `${provider} is not installed` })
    }

    const resume = this.database.state.get(`session.${provider}`)
    const session = providers[provider].open({
      executable,
      ...(resume ? { resume } : {}),
      onSession: (id) => this.database.state.set(`session.${provider}`, id),
      mcp: this.mcp,
    })
    this.sessions.set(provider, session)

    return session
  }

  private start(turn: QueuedTurn) {
    const choice = this.active()
    const session = this.session(choice.provider)
    const unseen = this.database.messages.unseenBy(choice.provider)
    const message = this.database.messages.insert({ ...turn, role: "user", provider: choice.provider })
    const started: ConversationEvent = { type: "started", message }
    this.running = { session, reply: "", started }
    this.publisher.publish("event", started)
    this.idle = this.answer({ ...choice, text: `${clock(new Date())}\n\n${withTranscript(unseen, framed(message))}`, session })

    return { message, finished: this.idle }
  }

  private async answer(turn: ProviderChoice & { text: string; session: ProviderSession }): Promise<TurnOutcome> {
    const result = await this.observability.span({ name: "provider.turn", attributes: { provider: turn.provider } }, () => turn.session.turn(turn, {
      delta: (text) => {
        if (this.running) {
          this.running.reply += text
          delete this.running.tool
        }

        this.publisher.publish("event", { type: "delta", text })
      },
      tool: (name) => {
        if (this.running) {
          this.running.tool = name
        }

        this.publisher.publish("event", { type: "tool", name })
      },
    })).catch((error: unknown): TurnResult => ({ outcome: "failed", error: errorMessage(error) }))
    const reply = this.running?.reply.trim()
    this.running = undefined
    const message = reply ? this.database.messages.insert({ role: "assistant", text: reply, provider: turn.provider }) : undefined

    this.publisher.publish("event", { type: "finished", outcome: result.outcome, ...(message ? { message } : {}), ...(result.error ? { error: result.error } : {}) })

    return result.outcome
  }
}
