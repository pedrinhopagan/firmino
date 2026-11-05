import { z } from "zod"

/** Where the Google connection stands. `connecting` waits for consent in the system browser; `disconnected` says why the last attempt or session ended. */
export const googleStatus = z.discriminatedUnion("state", [
  z.object({ state: z.literal("disconnected"), error: z.string().optional() }),
  z.object({ state: z.literal("connecting") }),
  z.object({ state: z.literal("connected"), account: z.string() }),
])

export type GoogleStatus = z.infer<typeof googleStatus>
