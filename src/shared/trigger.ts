import { z } from "zod"

/** Where a Gatilho listens: a WhatsApp target is a chat, an e-mail target a sender address or a whole domain written as "@domain". */
export const triggerSource = z.enum(["whatsapp", "email"])
const target = z.strictObject({ id: z.string().trim().includes("@", { message: "Take the chatId from whatsapp_chats, or give an e-mail address or @domain" }), name: z.string().trim().min(1) })
export const targets = z.array(target).min(1)

/** A Gatilho the agent created: it runs a turn when a message arrives from one of its targets, while active. */
export const trigger = z.object({
  id: z.string(),
  name: z.string().min(1),
  instruction: z.string().min(1),
  source: triggerSource,
  targets,
  canSend: z.boolean(),
  status: z.enum(["active", "paused"]),
  createdAt: z.string(),
})

export type Trigger = z.infer<typeof trigger>
export type TriggerTarget = z.infer<typeof target>
