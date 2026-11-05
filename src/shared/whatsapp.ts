import { z } from "zod"

/** Where the WhatsApp link stands. `linking` carries the QR code once WhatsApp sends one; `unlinked` says why a link attempt ended. */
export const whatsappStatus = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unlinked"), error: z.string().optional() }),
  z.object({ state: z.literal("linking"), qr: z.string().optional() }),
  z.object({ state: z.literal("connecting"), account: z.string().optional() }),
  z.object({ state: z.literal("connected"), account: z.string() }),
])

export type WhatsappStatus = z.infer<typeof whatsappStatus>
