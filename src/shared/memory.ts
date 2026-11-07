import { z } from "zod"

/** One memory: a single line the agent recorded, with its local date. Its id is its position in the log, from 0. */
export const storedMemory = z.object({ id: z.int(), date: z.string(), text: z.string() })

export type StoredMemory = z.infer<typeof storedMemory>
