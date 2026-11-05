import { z } from "zod"

export const providerId = z.enum(["codex", "claude"])

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

export const conversationMessage = z.object({
  id: z.int(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  provider: providerId,
  /** The account that answered, or that the user wrote to. */
  account: z.string(),
  /** The name of the Rotina that sent this message; null when the user wrote it or Kolega answered. */
  routine: z.string().nullable(),
  /** The name of the Gatilho that sent this message; null otherwise. */
  trigger: z.string().nullable(),
  createdAt: z.string(),
})

const turnOutcome = z.enum(["completed", "interrupted", "failed"])

/** The single event the Renderer receives about the conversation, whatever provider answers. */
export const conversationEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("started"), message: conversationMessage }),
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("tool"), name: z.string() }),
  z.object({ type: z.literal("finished"), outcome: turnOutcome, message: conversationMessage.optional(), error: z.string().optional() }),
])

const providerModel = z.object({ id: z.string(), label: z.string() })

export const providerStatus = z.object({
  account: providerAccount,
  installed: z.boolean(),
  loggedIn: z.boolean(),
  email: z.string().optional(),
  /** The subscription the provider reports, such as "pro" or "max". */
  plan: z.string().optional(),
  models: z.array(providerModel),
})

export const providerChoice = z.object({ account: z.string(), model: z.string().optional() })

export const newProviderAccount = providerAccount.pick({ provider: true, name: true, home: true })

/** A sign-in in progress: the page Kolega opened in the browser. */
export const providerLoginEvent = z.object({ url: z.url() })

export type ProviderId = z.infer<typeof providerId>
export type ProviderAccount = z.infer<typeof providerAccount>
export type NewProviderAccount = z.infer<typeof newProviderAccount>
export type ConversationMessage = z.infer<typeof conversationMessage>
export type ConversationEvent = z.infer<typeof conversationEvent>
export type TurnOutcome = z.infer<typeof turnOutcome>
export type ProviderStatus = z.infer<typeof providerStatus>
export type ProviderChoice = z.infer<typeof providerChoice>
