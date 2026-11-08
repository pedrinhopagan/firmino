import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { TurnOutcome } from "@src/shared/conversation"
import { parse } from "@src/shared/parse"
import { type Frequency, frequency, type Routine, routine, time, weekday, weekdays } from "@src/shared/routine"
import type { Conversation } from "./conversation"
import type { FirminoDatabase } from "./database"
import type { Observability } from "./observability"

const workdays = weekdays.slice(0, 5)

/** A Rotina as stored: the frequency column holds JSON. */
export const storedRoutine = routine.extend({
  frequency: z.string().transform((value): unknown => JSON.parse(value)).pipe(frequency),
})

const minute = 60_000
/** The timer re-arms at least this often, so a clock change or a suspended laptop delays a Rotina by an hour at most. */
const longestWait = 60 * minute

/** A date as local "YYYY-MM-DD HH:MM", the form the agent reads and writes. */
export function localMinute(date: Date) {
  return date.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })
}

function minutesOf(value: string) {
  const [hours = 0, minutes = 0] = value.split(":").map(Number)

  return hours * 60 + minutes
}

function intervalTimes(frequency: Extract<Frequency, { form: "interval" }>) {
  const times: string[] = []

  for (let value = minutesOf(frequency.startTime); value <= minutesOf(frequency.endTime); value += frequency.everyMinutes) {
    times.push(`${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`)
  }

  return times
}

/** The first run strictly after `from`, in the Engine's local time. */
function nextRun(frequency: Frequency, from: Date) {
  if (frequency.form === "once") {
    const at = new Date(frequency.at)

    if (at <= from) {
      throw new Error("That time has passed")
    }

    return at
  }

  const times = frequency.form === "fixed-time" ? frequency.times : intervalTimes(frequency)

  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(from)
    day.setDate(from.getDate() + offset)
    const dayName = weekdays[(day.getDay() + 6) % 7]

    if (!dayName || !frequency.days.includes(dayName)) {
      continue
    }

    for (const value of times) {
      const candidate = new Date(day)
      candidate.setHours(Math.floor(minutesOf(value) / 60), minutesOf(value) % 60, 0, 0)

      if (candidate > from) {
        return candidate
      }
    }
  }

  throw new Error("The schedule has no next run")
}

/** "HH:MM" means the next such time; "YYYY-MM-DD HH:MM" a given day. Both local. */
function parseAt(text: string, now: Date) {
  const match = text.trim().match(/^(?:(\d{4})-(\d{2})-(\d{2})[ T])?([01]\d|2[0-3]):([0-5]\d)$/)

  if (!match) {
    throw new Error('Give at as "HH:MM" or "YYYY-MM-DD HH:MM"')
  }

  const [, year, month, day, hours, minutes] = match
  const at = new Date(now)
  at.setSeconds(0, 0)

  if (year) {
    at.setFullYear(Number(year), Number(month) - 1, Number(day))

    // Date rolls an impossible day over into the next month; refuse it instead.
    if (at.getMonth() !== Number(month) - 1 || at.getDate() !== Number(day)) {
      throw new Error(`${year}-${month}-${day} is not a real date`)
    }
  }

  at.setHours(Number(hours), Number(minutes))

  if (!year && at <= now) {
    at.setDate(at.getDate() + 1)
  }

  return at
}

function scheduleText(frequency: Frequency) {
  if (frequency.form === "interval") {
    return `every ${frequency.everyMinutes} minutes on ${frequency.days.join(", ")}, from ${frequency.startTime} through ${frequency.endTime}`
  }

  if (frequency.form === "once") {
    return `once at ${localMinute(new Date(frequency.at))}`
  }

  return `${frequency.days.join(", ")} at ${frequency.times.join(", ")}`
}

function describe(routine: Routine) {
  const next = routine.nextRunAt ? `, next run ${localMinute(new Date(routine.nextRunAt))}` : ""

  return `"${routine.name}" (id ${routine.id}), ${scheduleText(routine.frequency)}, ${routine.status}${next}. Prompt: ${routine.prompt}`
}

const saveInput = {
  id: z.string().optional().describe("Id of the Rotina to change. Omit to create one."),
  name: z.string().trim().min(1).optional().describe("Short name. Required to create; omit to keep the current one."),
  prompt: z.string().trim().min(1).optional().describe("What you must do when it runs, written as an instruction to yourself, e.g. \"Lembre o usuário de beber água.\". Required to create; omit to keep the current one."),
  inMinutes: z.number().positive().optional().describe("Run once, this many minutes from now."),
  at: z.string().optional().describe("Run once at this local time: \"HH:MM\" for its next occurrence, or \"YYYY-MM-DD HH:MM\"."),
  days: z.array(weekday).min(1).optional().describe("Weekdays for a repeating Rotina. Defaults to every day with times, and to monday through friday with everyMinutes."),
  times: z.array(time).min(1).optional().describe("Local times as HH:MM for a Rotina that runs at fixed times on the chosen days."),
  everyMinutes: z.int().min(1).optional().describe("Repeat at this interval inside the startTime..endTime window on the chosen days."),
  startTime: time.optional().describe("Start of the interval window as HH:MM. Defaults to 00:00."),
  endTime: time.optional().describe("Inclusive end of the interval window as HH:MM. Defaults to 23:59."),
  enabled: z.boolean().optional().describe("false pauses the Rotina, true resumes it. Omit to keep it as it is; a new Rotina starts active."),
}

type SaveInput = z.infer<z.ZodObject<typeof saveInput>>

const scheduleFields = { interval: ["everyMinutes", "days", "startTime", "endTime"], "fixed-time": ["days", "times"] } as const
const scheduleDefaults = { interval: { days: workdays, startTime: "00:00", endTime: "23:59" }, "fixed-time": { days: weekdays } }

function given(fields: object) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
}

/** Which repeating schedule a save describes: the one its fields name, or the current one they adjust; nothing when they leave it alone. */
function repeatingForm(input: SaveInput, current?: Frequency) {
  const window = !!(input.days || input.startTime || input.endTime)

  if (input.everyMinutes || (current?.form === "interval" && !input.times && window)) {
    return "interval"
  }

  if (input.times || (current?.form === "fixed-time" && input.days)) {
    if (input.startTime || input.endTime) {
      throw new Error("startTime and endTime need everyMinutes; a Rotina at fixed times has no window")
    }

    return "fixed-time"
  }

  if (window) {
    throw new Error("days needs times or everyMinutes, and startTime and endTime need everyMinutes")
  }

  return undefined
}

/** The schedule a save asks for. Fields given replace the current schedule's; fields omitted keep it, so one change leaves the rest as it was. */
function frequencyFrom(input: SaveInput, current?: Routine): Frequency {
  if (input.inMinutes) {
    return parse(frequency, { form: "once", at: new Date(Date.now() + input.inMinutes * minute).toISOString() })
  }

  if (input.at) {
    return parse(frequency, { form: "once", at: parseAt(input.at, new Date()).toISOString() })
  }

  if (input.everyMinutes && input.times) {
    throw new Error("Give everyMinutes or times, not both")
  }

  const form = repeatingForm(input, current?.frequency)

  if (!form) {
    if (!current) {
      throw new Error("Give inMinutes or at to run once, times (and days) for fixed times, or everyMinutes for an interval")
    }

    return current.frequency
  }

  // Switching between repeating forms keeps the weekdays; the other fields belong to the old form.
  const kept = current?.frequency.form === form ? current.frequency : { days: current?.frequency.form === "once" ? undefined : current?.frequency.days }
  const values: Record<string, unknown> = { ...scheduleDefaults[form], ...given(kept), ...given(input) }

  return parse(frequency, { form, ...Object.fromEntries(scheduleFields[form].map((field) => [field, values[field]])) })
}

function statusFrom(enabled: boolean | undefined, current?: Routine) {
  if (enabled === undefined) {
    return current?.status ?? "active"
  }

  if (!enabled) {
    return "paused"
  }

  return "active"
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] }
}

/**
 * Firmino's Rotinas: scheduled reminders and tasks the agent manages through its MCP tools.
 * One timer waits for the earliest active Rotina. A run missed while the app was closed happens once on the next start;
 * a repeating Rotina then continues from its next time after now.
 */
export class Routines {
  private timer?: ReturnType<typeof setTimeout>
  private firing?: Promise<void>
  private closed = false

  constructor(private readonly database: FirminoDatabase, private readonly conversation: Pick<Conversation, "runQueued">, private readonly observability: Observability) {
    this.schedule()
  }

  registerTools(server: McpServer) {
    server.registerTool("save_routine", {
      description: "Create or change one Rotina: a named instruction that Firmino runs for you on a schedule, as a new turn in this conversation. Use it for tasks the user wants you to do later or repeatedly. For something the user must do or attend on a day, use save_appointment instead. Give an id to change an existing Rotina; omit it to create one. Times are the user's local time.",
      inputSchema: saveInput,
    }, (input) => this.observability.span({ name: "routines.save" }, () => text(`Rotina ${input.id ? "changed" : "created"}: ${describe(this.save(input))}`)))
    server.registerTool("list_routines", {
      description: "List every Rotina with its id, schedule, status and next run in local time.",
    }, () => {
      const routines = this.database.routines.list()

      return text(routines.length > 0 ? routines.map((routine) => `- ${describe(routine)}`).join("\n") : "No Rotinas.")
    })
    server.registerTool("remove_routine", {
      description: "Remove one Rotina for good.",
      inputSchema: { id: z.string().describe("Id of the Rotina to remove.") },
    }, ({ id }) => this.observability.span({ name: "routines.remove" }, () => text(`Rotina "${this.remove(id).name}" removed.`)))
  }

  /** Creates or changes one Rotina, as the agent's save_routine describes; the settings use it to pause and resume. */
  save(input: SaveInput) {
    const current = input.id ? this.existing(input.id) : undefined
    const name = input.name ?? current?.name
    const prompt = input.prompt ?? current?.prompt

    if (!name || !prompt) {
      throw new Error("Give name and prompt to create a Rotina")
    }

    const now = new Date()
    const routine = { id: current?.id ?? crypto.randomUUID(), name, prompt, frequency: frequencyFrom(input, current), status: statusFrom(input.enabled, current), createdAt: current?.createdAt ?? now.toISOString() }
    const saved: Routine = { ...routine, nextRunAt: routine.status === "active" ? nextRun(routine.frequency, now).toISOString() : null }
    this.database.routines.save(saved)
    this.schedule()

    return saved
  }

  remove(id: string) {
    const routine = this.existing(id)
    this.database.routines.remove(routine.id)
    this.schedule()

    return routine
  }

  close() {
    this.closed = true
    clearTimeout(this.timer)
  }

  private existing(id: string) {
    const routine = this.database.routines.get(id)

    if (!routine) {
      throw new Error("Rotina not found")
    }

    return routine
  }

  private schedule() {
    clearTimeout(this.timer)

    if (this.closed || this.firing) {
      return
    }

    const next = this.database.routines.nextRunAt()

    if (!next) {
      return
    }

    this.timer = setTimeout(() => {
      this.firing = this.fire().catch((error: unknown) => {
        this.observability.event({ name: "routines.firefailed", error })
      }).finally(() => {
        this.firing = undefined
        this.schedule()
      })
    }, Math.min(Math.max(Date.parse(next) - Date.now(), 0), longestWait))
  }

  /** Runs every due Rotina in turn order. A repeating one moves to its next time as its turn starts; a one-time one is closed after. */
  private async fire() {
    for (const due of this.database.routines.due(new Date())) {
      const outcome = await this.conversation.runQueued(() => {
        const routine = this.claim(due)

        return routine && { text: routine.prompt, routine: routine.name }
      }).catch((error: unknown): TurnOutcome => {
        this.observability.event({ name: "routines.runfailed", error })

        return "failed"
      })

      if (!outcome) {
        continue
      }

      this.observability.event({ name: "routines.ran", attributes: { status: outcome } })

      if (due.frequency.form !== "once") {
        continue
      }

      const after = this.database.routines.get(due.id)

      if (after?.status === "active" && after.nextRunAt === due.nextRunAt) {
        this.database.routines.save({ ...after, status: outcome === "failed" ? "failed" : "completed", nextRunAt: null })
      }
    }
  }

  /** The Rotina to run for this due occurrence, read as its turn starts; nothing when a turn meanwhile removed, paused or rescheduled it. */
  private claim(due: Routine) {
    const routine = this.database.routines.get(due.id)

    if (this.closed || routine?.status !== "active" || routine.nextRunAt !== due.nextRunAt) {
      return undefined
    }

    if (routine.frequency.form !== "once") {
      this.database.routines.save({ ...routine, nextRunAt: nextRun(routine.frequency, new Date()).toISOString() })
    }

    return routine
  }
}
