import { z } from "zod"

export const providerId = z.enum(["codex", "claude"])

/** Effort names come from the provider's model catalog. */
export const providerEffort = z.string().min(1)

/**
 * One account of a provider, as T3 Code's provider instances: its own home folder holds its login.
 * Without `home`, the provider uses its default folder (~/.codex or ~/.claude).
 */
export const providerAccount = z.object({
  id: z.string().min(1),
  provider: providerId,
  name: z.string().trim().min(1),
  /** CODEX_HOME for Codex, CLAUDE_CONFIG_DIR for Claude. */
  home: z.string().min(1).optional(),
  binary: z.string().min(1).optional(),
  enabled: z.boolean(),
})

/** One question the agent asks, as T3 Code's ask: the user picks options or writes another answer. */
const agentQuestion = z.object({
  id: z.string(),
  /** A short tag shown above the question. */
  header: z.string(),
  question: z.string(),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
  multiSelect: z.boolean(),
})

/** The user's answers by question id. */
export const questionAnswers = z.record(z.string(), z.array(z.string().trim().min(1)).min(1))

const workStatus = z.enum(["running", "completed", "failed"])
const workPlace = {
  id: z.string(),
  status: workStatus,
  /** How much reply text came before it, so the work shows between the right paragraphs. */
  at: z.int().min(0),
}

/** One step of a turn's work, as T3 Code's work log shows it. */
export const workEntry = z.discriminatedUnion("kind", [
  z.object({ ...workPlace, kind: z.literal("thinking"), text: z.string() }),
  z.object({
    ...workPlace,
    kind: z.literal("question"),
    questions: z.array(agentQuestion),
    /** Absent while the agent waits, and when the user dismissed the questions. */
    answers: questionAnswers.optional(),
  }),
  z.object({
    ...workPlace,
    kind: z.enum(["command", "read", "edit", "search", "web", "tool"]),
    /** The command, the files one per line, the search or the tool's name. */
    title: z.string(),
    /** The input and output a click on the row reveals. */
    detail: z.string().optional(),
    /** The absolute path of an image the agent viewed or made. */
    image: z.string().optional(),
  }),
])

export const conversationMessage = z.object({
  id: z.int(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  provider: providerId,
  /** The account that answered, or that the user wrote to. */
  account: z.string(),
  /** The name of the Rotina that sent this message; null when the user wrote it or Firmino answered. */
  routine: z.string().nullable(),
  /** The name of the Gatilho that sent this message; null otherwise. */
  trigger: z.string().nullable(),
  /** What the agent did before and between the paragraphs of its answer. */
  work: z.array(workEntry).optional(),
  createdAt: z.string(),
})

const turnOutcome = z.enum(["completed", "interrupted", "failed"])

/** The single event the Renderer receives about the conversation, whatever provider answers. */
export const conversationEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("started"), message: conversationMessage }),
  z.object({ type: z.literal("delta"), text: z.string() }),
  /** A new step of the turn's work, or a newer state of one it sent before. */
  z.object({ type: z.literal("work"), entry: workEntry }),
  z.object({ type: z.literal("finished"), outcome: turnOutcome, message: conversationMessage.optional(), error: z.string().optional() }),
])

const providerModel = z.object({
  id: z.string(),
  label: z.string(),
  isDefault: z.boolean(),
  /** A newer version of the same family replaces it; the picker folds it away, as T3 Code does. */
  legacy: z.boolean(),
  efforts: z.array(providerEffort),
  defaultEffort: providerEffort.optional(),
})

export const providerStatus = z.object({
  account: providerAccount,
  installed: z.boolean(),
  loggedIn: z.boolean(),
  email: z.string().optional(),
  /** The subscription the provider reports, such as "pro" or "max". */
  plan: z.string().optional(),
  models: z.array(providerModel),
})

export const providerChoice = z.object({
  account: z.string(),
  model: z.string().optional(),
  /** Omitted keeps this model's saved effort. */
  effort: providerEffort.optional(),
})

export const newProviderAccount = providerAccount.pick({ provider: true, name: true, home: true })

/** A sign-in in progress: the page Firmino opened in the browser. */
export const providerLoginEvent = z.object({ url: z.url() })

/** A starred model of one account. */
export const favoriteModel = z.object({ account: z.string(), model: z.string() })

export type ProviderId = z.infer<typeof providerId>
export type ProviderAccount = z.infer<typeof providerAccount>
export type NewProviderAccount = z.infer<typeof newProviderAccount>
export type ConversationMessage = z.infer<typeof conversationMessage>
export type ConversationEvent = z.infer<typeof conversationEvent>
export type AgentQuestion = z.infer<typeof agentQuestion>
export type QuestionAnswers = z.infer<typeof questionAnswers>
export type WorkEntry = z.infer<typeof workEntry>
export type TurnOutcome = z.infer<typeof turnOutcome>
export type ProviderStatus = z.infer<typeof providerStatus>
export type ProviderModel = z.infer<typeof providerModel>
export type ProviderChoice = z.infer<typeof providerChoice>
export type FavoriteModel = z.infer<typeof favoriteModel>
