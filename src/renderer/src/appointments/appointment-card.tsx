import { CalendarIcon, ExclamationTriangleIcon } from "@heroicons/react/16/solid"
import { useMutation } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import { type ReactNode, useEffect, useState } from "react"
import type { Appointment } from "@src/shared/appointment"
import type { EngineClient } from "../engine-client"
import { Button } from "../ui/button"
import { openAppointment } from "../settings/menu-navigation"
import { appointmentStore } from "./appointment-events"

const tickMs = 30_000
const hourMs = 3_600_000
const minuteMs = 60_000
const calendarDay = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short" })
const relative = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" })
const relativeShort = new Intl.RelativeTimeFormat("pt-BR", { style: "short" })

/** The current time, again every 30 seconds, so a card shows, changes its text and turns late on its own. */
export function useNow() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), tickMs)

    return () => clearInterval(timer)
  }, [])

  return now
}

function localDay(date: Date) {
  return date.toLocaleDateString("sv-SE")
}

/** A day after its date, a Compromisso still pending is late. */
export function isLate(appointment: Pick<Appointment, "date">, now: Date) {
  return appointment.date < localDay(now)
}

/** "hoje", "amanhã", or the weekday and date. */
function dayText(day: string, now: Date) {
  const date = new Date(`${day}T00:00`)
  const today = new Date(`${localDay(now)}T00:00`)
  const days = Math.round((date.getTime() - today.getTime()) / (24 * hourMs))

  if (Math.abs(days) <= 1) {
    return relative.format(days, "day")
  }

  return calendarDay.format(date)
}

function capitalized(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** How far the start is, while it is today: "em 12 min.", "há 2 h". */
function distance(start: Date, now: Date) {
  const minutes = Math.round((start.getTime() - now.getTime()) / minuteMs)

  if (minutes === 0) {
    return "agora"
  }

  if (Math.abs(minutes) < 60) {
    return relativeShort.format(minutes, "minute")
  }

  return relativeShort.format(Math.round((start.getTime() - now.getTime()) / hourMs), "hour")
}

/** What the card says about when: late since a day, the whole day, or a time and how far it is today. */
export function whenText(appointment: Pick<Appointment, "date" | "time">, now: Date) {
  const day = dayText(appointment.date, now)

  if (isLate(appointment, now)) {
    return `Atrasado desde ${day}`
  }

  const at = scheduledText(appointment, now)

  if (!appointment.time || appointment.date !== localDay(now)) {
    return at
  }

  return `${at} · ${distance(new Date(`${appointment.date}T${appointment.time}`), now)}`
}

/** The day and time it is marked for, without how far or how late: "Hoje às 14:43", "Ter., 17 de nov., o dia todo". */
export function scheduledText(appointment: Pick<Appointment, "date" | "time">, now: Date) {
  const day = capitalized(dayText(appointment.date, now))

  if (!appointment.time) {
    return `${day}, o dia todo`
  }

  return `${day} às ${appointment.time}`
}

/** When the alert opens: before the time, or in the morning of a whole-day Compromisso. */
export function remindText(appointment: Pick<Appointment, "time" | "remindMinutes">) {
  if (!appointment.time) {
    return "No dia, às 09:00"
  }

  if (appointment.remindMinutes === 0) {
    return "Na hora"
  }

  return `${appointment.remindMinutes} min antes`
}

/**
 * One Compromisso as a card, the same in the app and in its alert; late, it turns to the alert colors.
 * Its title and time keep to one line each, and clicking them opens the Compromisso.
 */
export function AppointmentCard({ appointment, now, onOpen, children }: { appointment: Pick<Appointment, "title" | "date" | "time">; now: Date; onOpen: () => void; children?: ReactNode }) {
  const late = isLate(appointment, now)
  const Icon = late ? ExclamationTriangleIcon : CalendarIcon

  return (
    <div className={`flex items-center gap-2.5 rounded-lg border py-2 pr-3 pl-1.5 ${late ? "border-destructive/32 bg-destructive/4" : "bg-card"}`}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-0.5 text-left outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" title={appointment.title} onClick={onOpen}>
        <Icon className={`size-4 shrink-0 ${late ? "text-destructive-foreground" : "text-primary"}`} aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">{appointment.title}</span>
          <span className={`truncate text-xs ${late ? "text-destructive-foreground" : "text-muted-foreground"}`}>{whenText(appointment, now)}</span>
        </span>
      </button>
      {children}
    </div>
  )
}

export function CompleteButton({ client, appointment }: { client: EngineClient; appointment: Pick<Appointment, "id" | "title"> }) {
  const complete = useMutation({ mutationFn: () => client.appointments.complete({ id: appointment.id }) })

  return (
    <Button className="h-7 px-2.5 text-xs" variant="secondary" aria-label={`Concluir ${appointment.title}`} title={complete.error?.message} disabled={complete.isPending} onClick={() => complete.mutate()}>
      Concluir
    </Button>
  )
}

/** The Compromissos whose time to show has come, pinned above the conversation until each is done. */
export function PinnedAppointments({ client }: { client: EngineClient }) {
  const now = useNow()
  // Read the clock again on every render: an alert updates the list right at its notice time, before the next tick.
  const shown = useStore(appointmentStore, (state) => state.appointments)?.filter((appointment) => appointment.status === "pending" && Date.parse(appointment.noticeAt) <= Date.now())

  if (!shown?.length) {
    return null
  }

  return (
    <section className="flex max-h-[40%] shrink-0 flex-col overflow-y-auto border-b" aria-label="Compromissos">
      <div className="mx-auto flex w-full max-w-184 flex-col gap-2 px-3 py-2.5">
        {shown.map((appointment) => (
          <AppointmentCard key={appointment.id} appointment={appointment} now={now} onOpen={() => openAppointment(appointment.id)}>
            <CompleteButton client={client} appointment={appointment} />
          </AppointmentCard>
        ))}
      </div>
    </section>
  )
}
