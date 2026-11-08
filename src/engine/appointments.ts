import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { EventPublisher } from "@orpc/server"
import { z } from "zod"
import { type Appointment, appointment, localDay } from "@src/shared/appointment"
import { time } from "@src/shared/routine"
import type { FirminoDatabase } from "./database"
import type { Observability } from "./observability"

/** A Compromisso as stored: with the time of its next alert, which only the Engine reads. */
export const storedAppointment = appointment.extend({ nextAlertAt: z.string().nullable() })

export type StoredAppointment = z.infer<typeof storedAppointment>

const minute = 60_000
/** The timer re-arms at least this often, so a clock change or a suspended laptop delays an alert by an hour at most. */
const longestWait = 60 * minute
const defaultRemindMinutes = 15
/** The local hour a whole-day Compromisso alerts on its day, and a late one on each day after. */
const dailyAlertHour = 9

type Schedule = Pick<Appointment, "date" | "time" | "remindMinutes">

/** A local day and time as a Date; refuses a day the calendar does not have. */
function localDate(day: string, at = "00:00") {
  const date = new Date(`${day}T${at}`)

  if (Number.isNaN(date.getTime()) || date.toLocaleDateString("sv-SE") !== day) {
    throw new Error(`${day} is not a real date`)
  }

  return date
}

function dailyAlert(day: string, daysAfter: number) {
  const date = localDate(day)
  date.setDate(date.getDate() + daysAfter)
  date.setHours(dailyAlertHour)

  return date
}

/** When the card shows: `remindMinutes` before a timed Compromisso, the start of the day for a whole-day one. */
function noticeAt(appointment: Schedule) {
  if (!appointment.time) {
    return localDate(appointment.date)
  }

  return new Date(localDate(appointment.date, appointment.time).getTime() - appointment.remindMinutes * minute)
}

/** The first alert strictly after `after`: at the notice of a timed Compromisso or at 09:00 of a whole-day one's day, then at 09:00 of each later day it stays pending. */
function nextAlert(appointment: Schedule, after: Date) {
  const first = appointment.time ? noticeAt(appointment) : dailyAlert(appointment.date, 0)

  if (first > after) {
    return first
  }

  const late = dailyAlert(appointment.date, 1)
  const next = new Date(after)
  next.setHours(dailyAlertHour, 0, 0, 0)

  if (next <= after) {
    next.setDate(next.getDate() + 1)
  }

  if (next < late) {
    return late
  }

  return next
}

function describe(appointment: Appointment) {
  const when = appointment.time ? `${appointment.date} ${appointment.time}, alert ${appointment.remindMinutes} minutes before` : `${appointment.date}, all day`

  return `"${appointment.title}" (id ${appointment.id}), ${when}, ${appointment.status}`
}

const saveInput = {
  id: z.string().optional().describe("Id of the Compromisso to change. Omit to create one."),
  title: z.string().trim().min(1).optional().describe("What the user has to do, short, as the card shows it. Required to create."),
  date: localDay.optional().describe("Local day as \"YYYY-MM-DD\". Required to create."),
  time: time.nullable().optional().describe("Local time as \"HH:MM\". Omit or give null for a whole-day Compromisso, which shows all day."),
  remindMinutes: z.int().min(0).optional().describe(`How many minutes before the time to alert the user. Defaults to ${defaultRemindMinutes}; ignored without a time.`),
}

type SaveInput = z.infer<z.ZodObject<typeof saveInput>>

/** The day, time and alert a save asks for: the fields given, and the current ones for the rest. */
function scheduleFrom(input: SaveInput, current?: Schedule): Schedule | undefined {
  const date = input.date ?? current?.date

  if (!date) {
    return undefined
  }

  return { date, time: input.time === undefined ? current?.time ?? null : input.time, remindMinutes: input.remindMinutes ?? current?.remindMinutes ?? defaultRemindMinutes }
}

function sameSchedule(current: Schedule, next: Schedule) {
  return current.date === next.date && current.time === next.time && current.remindMinutes === next.remindMinutes
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] }
}

/**
 * Firmino's Compromissos: what the user must do on a day, shown as a card in the app until they mark it done.
 * One timer waits for the earliest alert. An alert asks Main to open the cards outside the app; one missed while the app was closed happens on the next start.
 */
export class Appointments {
  private timer?: ReturnType<typeof setTimeout>
  private closed = false
  private readonly publisher = new EventPublisher<{ appointments: Appointment[] }>()

  constructor(private readonly database: FirminoDatabase, private readonly observability: Observability, private readonly onAlert: () => void) {}

  /** Starts the alerts, after the Engine told Main it is ready: an alert still open from the last run opens again. */
  start() {
    if (this.database.appointments.list().some((item) => item.status === "pending" && item.alertedAt && (!item.dismissedAt || item.dismissedAt < item.alertedAt))) {
      this.onAlert()
    }

    this.schedule()
  }

  registerTools(server: McpServer) {
    server.registerTool("save_appointment", {
      description: "Create or change one Compromisso: something the user must do or attend on a day. Firmino shows it as a pinned card and alerts on screen until the user marks it done. Give an id to change one; omit it to create one. Times are the user's local time.",
      inputSchema: saveInput,
    }, (input) => this.observability.span({ name: "appointments.save" }, () => text(`Compromisso ${input.id ? "changed" : "created"}: ${describe(this.save(input))}`)))
    server.registerTool("list_appointments", {
      description: "List every Compromisso with its id, day, time, alert and status.",
    }, () => {
      const appointments = this.database.appointments.list()

      return text(appointments.length > 0 ? appointments.map((item) => `- ${describe(item)}`).join("\n") : "No Compromissos.")
    })
    server.registerTool("complete_appointment", {
      description: "Mark one Compromisso done, when the user says they did it. Its card and alerts stop.",
      inputSchema: { id: z.string().describe("Id of the Compromisso.") },
    }, ({ id }) => this.observability.span({ name: "appointments.complete" }, () => text(`Compromisso "${this.complete(id).title}" done.`)))
    server.registerTool("remove_appointment", {
      description: "Remove one Compromisso for good.",
      inputSchema: { id: z.string().describe("Id of the Compromisso.") },
    }, ({ id }) => this.observability.span({ name: "appointments.remove" }, () => text(`Compromisso "${this.remove(id).title}" removed.`)))
  }

  /** The current Compromissos first, then the whole list again after every change. */
  async *events(signal?: AbortSignal) {
    const live = this.publisher.subscribe("appointments", { signal })

    yield this.database.appointments.list()
    yield* live
  }

  /** Creates or changes one Compromisso. A new day, time or alert starts it over as pending, skipping the alerts already past. */
  save(input: SaveInput) {
    const current = input.id ? this.existing(input.id) : undefined
    const title = input.title ?? current?.title
    const when = scheduleFrom(input, current)

    if (!title || !when) {
      throw new Error("Give title and date to create a Compromisso")
    }

    const now = new Date()
    const saved: StoredAppointment = current && sameSchedule(current, when) ? { ...current, title } : {
      id: current?.id ?? crypto.randomUUID(),
      title,
      ...when,
      status: "pending",
      noticeAt: noticeAt(when).toISOString(),
      alertedAt: null,
      dismissedAt: null,
      nextAlertAt: nextAlert(when, now).toISOString(),
      createdAt: current?.createdAt ?? now.toISOString(),
    }
    this.store(saved)

    return saved
  }

  complete(id: string) {
    const done = { ...this.existing(id), status: "done" as const, nextAlertAt: null }
    this.store(done)

    return done
  }

  /** Closes its alert outside the app; the card stays in the app until it is done. */
  dismiss(id: string) {
    this.store({ ...this.existing(id), dismissedAt: new Date().toISOString() })
  }

  remove(id: string) {
    const removed = this.existing(id)
    this.database.appointments.remove(removed.id)
    this.changed()

    return removed
  }

  close() {
    this.closed = true
    clearTimeout(this.timer)
  }

  private existing(id: string) {
    const found = this.database.appointments.get(id)

    if (!found) {
      throw new Error("Compromisso not found")
    }

    return found
  }

  private store(appointment: StoredAppointment) {
    this.database.appointments.save(appointment)
    this.changed()
  }

  private changed() {
    this.publisher.publish("appointments", this.database.appointments.list())
    this.schedule()
  }

  private schedule() {
    clearTimeout(this.timer)

    if (this.closed) {
      return
    }

    const next = this.database.appointments.nextAlertAt()

    if (!next) {
      return
    }

    this.timer = setTimeout(() => this.alert(), Math.min(Math.max(Date.parse(next) - Date.now(), 0), longestWait))
  }

  /** Alerts every due Compromisso once, however many of its alerts passed while the app was closed. */
  private alert() {
    const now = new Date()
    const due = this.database.appointments.due(now)

    for (const item of due) {
      this.database.appointments.save({ ...item, alertedAt: now.toISOString(), nextAlertAt: nextAlert(item, now).toISOString() })
    }

    if (due.length === 0) {
      this.schedule()

      return
    }

    this.observability.event({ name: "appointments.alerted", attributes: { count: due.length } })
    this.onAlert()
    this.changed()
  }
}
