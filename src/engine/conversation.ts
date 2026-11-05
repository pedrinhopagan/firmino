import { EventPublisher, ORPCError } from "@orpc/server"
import type { ConversationEvent, ConversationMessage, ProviderChoice, ProviderId, ProviderStatus } from "@src/shared/conversation"
import { providerId } from "@src/shared/conversation"
import type { KolegaDatabase } from "./database"
import type { Observability } from "./observability"
import { ClaudeSession, claudeStatus } from "./providers/claude"
import { CodexSession, codexStatus } from "./providers/codex"
import { errorMessage, type ProviderSession, type ProviderSessionOptions, type TurnResult } from "./providers/provider"

const speakers = { user: "Usuário", assistant: "Kolega" }

/** Hands a provider the turns another provider answered, so switching keeps the context. */
function withTranscript(unseen: Pick<ConversationMessage, "role" | "text">[], text: string) {
  if (unseen.length === 0) {
    return text
  }

  const transcript = unseen.map((message) => `${speakers[message.role]}: ${message.text}`).join("\n\n")

  return `Mensagens anteriores desta conversa, que você ainda não viu:\n\n${transcript}\n\nMensagem atual do usuário:\n\n${text}`
}

const providers = {
  codex: { status: codexStatus, open: (options: ProviderSessionOptions) => new CodexSession(options) },
  claude: { status: claudeStatus, open: (options: ProviderSessionOptions) => new ClaudeSession(options) },
}

/** The one conversation Kolega keeps: its messages, the provider that answers and the turn in progress. */
export class Conversation {
  private readonly sessions = new Map<ProviderId, ProviderSession>()
  private readonly publisher = new EventPublisher<{ event: ConversationEvent }>({ maxBufferedEvents: Number.POSITIVE_INFINITY })
  private running?: { session: ProviderSession; reply: string; started: ConversationEvent }

  constructor(private readonly database: KolegaDatabase, private readonly observability: Observability) {}

  send(text: string) {
    if (this.running) {
      throw new ORPCError("TURN_RUNNING")
    }

    const choice = this.active()
    const session = this.session(choice.provider)
    const prompt = withTranscript(this.database.messages.unseenBy(choice.provider), text)
    const message = this.database.messages.insert({ role: "user", text, provider: choice.provider })
    const started: ConversationEvent = { type: "started", message }
    this.running = { session, reply: "", started }
    this.publisher.publish("event", started)
    void this.answer({ ...choice, text: prompt, session })

    return message
  }

  async interrupt() {
    await this.running?.session.interrupt()
  }

  async *events(signal?: AbortSignal) {
    const live = this.publisher.subscribe("event", { signal, maxBufferedEvents: Number.POSITIVE_INFINITY })
    // Taken in the same tick as the subscription, so the snapshot and the live events neither overlap nor leave a gap.
    const snapshot: ConversationEvent[] = this.running ? [this.running.started, { type: "delta", text: this.running.reply }] : []

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
    })
    this.sessions.set(provider, session)

    return session
  }

  private async answer(turn: ProviderChoice & { text: string; session: ProviderSession }) {
    const result = await this.observability.span({ name: "provider.turn", attributes: { provider: turn.provider } }, () => turn.session.turn(turn, (text) => {
      if (this.running) {
        this.running.reply += text
      }

      this.publisher.publish("event", { type: "delta", text })
    })).catch((error: unknown): TurnResult => ({ outcome: "failed", error: errorMessage(error) }))
    const reply = this.running?.reply.trim()
    this.running = undefined
    const message = reply ? this.database.messages.insert({ role: "assistant", text: reply, provider: turn.provider }) : undefined

    this.publisher.publish("event", { type: "finished", outcome: result.outcome, ...(message ? { message } : {}), ...(result.error ? { error: result.error } : {}) })
  }
}
