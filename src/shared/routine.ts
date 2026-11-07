import { z } from "zod"

export const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const
export const weekday = z.enum(weekdays)
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const chosenDays = z.array(weekday).min(1)

/** When a Rotina runs: at an interval inside a daily window, at fixed times, or once. Times are the user's local time. */
export const frequency = z.discriminatedUnion("form", [
  z.strictObject({ form: z.literal("interval"), everyMinutes: z.int().min(1), days: chosenDays, startTime: time, endTime: time }),
  z.strictObject({ form: z.literal("fixed-time"), days: chosenDays, times: z.array(time).min(1).transform((times) => [...new Set(times)].toSorted()) }),
  z.strictObject({ form: z.literal("once"), at: z.iso.datetime() }),
]).refine((value) => value.form !== "interval" || value.endTime >= value.startTime, { message: "endTime must not be before startTime", path: ["endTime"] })

/** A Rotina the agent created. A repeating one is active or paused; a one-time one ends completed or failed after it runs. */
export const routine = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  frequency,
  status: z.enum(["active", "paused", "completed", "failed"]),
  nextRunAt: z.string().nullable(),
  createdAt: z.string(),
})

export type Weekday = z.infer<typeof weekday>
export type Frequency = z.infer<typeof frequency>
export type Routine = z.infer<typeof routine>
