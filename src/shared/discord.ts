import { z } from "zod"

/** Where the Discord connection stands. `disconnected` says why Discord ended the last connection, when it did. */
export const discordStatus = z.discriminatedUnion("state", [
  z.object({ state: z.literal("disconnected"), error: z.string().optional() }),
  z.object({ state: z.literal("connected"), account: z.string() }),
])

export type DiscordStatus = z.infer<typeof discordStatus>
