import { EventPublisher, ORPCError } from "@orpc/server"
import { z } from "zod"
import type { ConversationEvent, ConversationMessage, FavoriteModel, ProviderChoice, TurnOutcome } from "@src/shared/conversation"
import { favoriteModel } from "@src/shared/conversation"
import { parse } from "@src/shared/parse"
import type { KolegaDatabase } from "./database"
import type { KolegaMcpConnection } from "./kolega-mcp"
import type { Memory } from "./memory"
import type { Observability } from "./observability"
import { ClaudeSession } from "./providers/claude"
import { CodexSession } from "./providers/codex"
import { errorMessage, type ProviderSession, type ProviderSessionOptions, type TurnResult } from "./providers/provider"
import type { ProviderAccounts } from "./providers/provider-accounts"
import { localMinute } from "./routines"

const storedFavorites = z.string().transform((value): unknown => JSON.parse(value)).pipe(z.array(favoriteModel))

const speakers = { user: "Usuário", assistant: "Kolega" }

/** A turn Kolega starts on its own: a Rotina's prompt, or a Gatilho's instruction with the messages that fired it. */
export interface QueuedTurn {
  text: string
  routine?: string
  trigger?: string
}

type Framed = Pick<ConversationMessage, "role" | "text" | "routine" | "trigger">

export interface QueuedTurnEnd extends TurnResult, Pick<ConversationMessage, "routine" | "trigger"> {
  reply?: string
}

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

const sessionTypes = {
  codex: (options: ProviderSessionOptions) => new CodexSession(options),
  claude: (options: ProviderSessionOptions) => new ClaudeSession(options),
}

/** The one conversation Kolega keeps: its messages, the provider account that answers and the turn in progress. Each account keeps its own session. */
export class Conversation {
  private readonly sessions = new Map<string, ProviderSession>()
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly publisher = new EventPublisher<{ event: ConversationEvent }>({ maxBufferedEvents: Number.POSITIVE_INFINITY })
  private running?: { session: ProviderSession; reply: string; tool?: string; started: ConversationEvent }
  /** Settles when the turn in progress ends. */
  private idle: Promise<TurnOutcome> = Promise.resolve("completed")

  constructor(private readonly database: KolegaDatabase, private readonly observability: Observability, private readonly accounts: ProviderAccounts, private readonly memory: Memory, private readonly mcp: KolegaMcpConnection, private readonly providerIdleMs: number, private readonly onQueuedTurnEnd: (end: QueuedTurnEnd) => void) {}

  async send(text: string) {
    await this.accounts.ready()

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
    await this.accounts.ready()

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

  /** The chosen account, or the first one on when the chosen one was turned off or removed. */
  active(): ProviderChoice {
    const enabled = this.accounts.list().filter((account) => account.enabled)
    const chosen = this.database.state.get("account")
    const account = enabled.find((known) => known.id === chosen) ?? enabled[0]

    if (!account) {
      throw new ORPCError("PRECONDITION_FAILED", { message: "Nenhuma conta de fornecedor ativa. Ative uma em Configurações." })
    }

    const model = this.database.state.get(`model.${account.id}`)

    return { account: account.id, ...(model ? { model } : {}) }
  }

  choose(choice: ProviderChoice) {
    if (this.running) {
      throw new ORPCError("TURN_RUNNING")
    }

    // Throws for an account that is missing, off, or whose CLI is not installed.
    this.accounts.launch(choice.account)
    this.database.state.set("account", choice.account)
    this.database.state.set(`model.${choice.account}`, choice.model)

    return this.active()
  }

  favorites() {
    const stored = this.database.state.get("favorites")

    if (stored === undefined) {
      return []
    }

    return parse(storedFavorites, stored)
  }

  toggleFavorite(toggled: FavoriteModel) {
    const current = this.favorites()
    const kept = current.filter((favorite) => favorite.account !== toggled.account || favorite.model !== toggled.model)
    const favorites = kept.length < current.length ? kept : [...current, toggled]
    this.database.state.set("favorites", JSON.stringify(favorites))

    return favorites
  }

  close() {
    for (const session of this.sessions.values()) {
      session.close()
    }
  }

  private session(accountId: string) {
    clearTimeout(this.idleTimers.get(accountId))
    const { account, ...launch } = this.accounts.launch(accountId)
    const existing = this.sessions.get(accountId)

    if (existing) {
      return { account, session: existing }
    }

    const resume = this.database.state.get(`session.${accountId}`)
    const session = sessionTypes[account.provider]({
      launch,
      ...(resume ? { resume } : {}),
      onSession: (id) => this.database.state.set(`session.${accountId}`, id),
      mcp: this.mcp,
    })
    this.sessions.set(accountId, session)

    return { account, session }
  }

  private closeWhenIdle(accountId: string, provider: string) {
    this.idleTimers.set(accountId, setTimeout(() => {
      this.idleTimers.delete(accountId)
      this.sessions.get(accountId)?.close()
      this.sessions.delete(accountId)
      this.observability.event({ name: "provider.idleclosed", attributes: { provider } })
    }, this.providerIdleMs))
  }

  private start(turn: QueuedTurn) {
    const choice = this.active()
    const { account, session } = this.session(choice.account)
    const unseen = this.database.messages.unseenBy(account.id)
    const memory = this.memory.forTurn(this.database.state.get(`session.${account.id}`))
    const message = this.database.messages.insert({ ...turn, role: "user", provider: account.provider, account: account.id })
    const started: ConversationEvent = { type: "started", message }
    this.running = { session, reply: "", started }
    this.publisher.publish("event", started)
    this.idle = this.answer({ ...choice, provider: account.provider, text: [clock(new Date()), memory.document, withTranscript(unseen, framed(message))].filter(Boolean).join("\n\n"), session, memory, origin: message })

    return { message, finished: this.idle }
  }

  private async answer(turn: ProviderChoice & Pick<ConversationMessage, "provider"> & { text: string; session: ProviderSession; memory: Pick<ReturnType<Memory["forTurn"]>, "read">; origin: Pick<ConversationMessage, "routine" | "trigger"> }): Promise<TurnOutcome> {
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
    this.closeWhenIdle(turn.account, turn.provider)
    const thread = this.database.state.get(`session.${turn.account}`)

    // A failed turn may never have reached the provider, so its session reads the memory again on the next turn.
    if (thread && result.outcome !== "failed") {
      turn.memory.read(thread)
    }

    const message = reply ? this.database.messages.insert({ role: "assistant", text: reply, provider: turn.provider, account: turn.account }) : undefined

    this.publisher.publish("event", { type: "finished", outcome: result.outcome, ...(message ? { message } : {}), ...(result.error ? { error: result.error } : {}) })

    if (turn.origin.routine || turn.origin.trigger) {
      this.onQueuedTurnEnd({ routine: turn.origin.routine, trigger: turn.origin.trigger, outcome: result.outcome, ...(reply ? { reply } : {}), ...(result.error ? { error: result.error } : {}) })
    }

    return result.outcome
  }
}
