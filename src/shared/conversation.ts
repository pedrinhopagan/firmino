import { z } from "zod"

export const providerId = z.enum(["codex", "claude"])

export const conversationMessage = z.object({
  id: z.int(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  provider: providerId,
  /** The name of the Rotina that sent this message; null when the user wrote it or Kolega answered. */
  routine: z.string().nullable(),
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
  provider: providerId,
  installed: z.boolean(),
  loggedIn: z.boolean(),
  account: z.string().optional(),
  models: z.array(providerModel),
})

export const providerChoice = z.object({ provider: providerId, model: z.string().optional() })

export type ProviderId = z.infer<typeof providerId>
export type ConversationMessage = z.infer<typeof conversationMessage>
export type ConversationEvent = z.infer<typeof conversationEvent>
export type TurnOutcome = z.infer<typeof turnOutcome>
export type ProviderStatus = z.infer<typeof providerStatus>
export type ProviderChoice = z.infer<typeof providerChoice>
