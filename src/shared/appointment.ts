import { z } from "zod"
import { time } from "./routine"

export const localDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/**
 * A Compromisso: something the user must do on a day, at a time or the whole day, until they mark it done.
 * Its card shows in the app from `noticeAt` on. An alert opens it outside the app at `alertedAt`; closing the alert sets `dismissedAt`.
 */
export const appointment = z.object({
  id: z.string(),
  title: z.string(),
  /** The local day, "YYYY-MM-DD". */
  date: localDay,
  /** The local time, "HH:MM"; absent for a whole-day Compromisso. */
  time: time.nullable(),
  /** How many minutes before `time` the card shows and the alert opens. */
  remindMinutes: z.int().min(0),
  status: z.enum(["pending", "done"]),
  noticeAt: z.string(),
  alertedAt: z.string().nullable(),
  dismissedAt: z.string().nullable(),
  createdAt: z.string(),
})

export type Appointment = z.infer<typeof appointment>
