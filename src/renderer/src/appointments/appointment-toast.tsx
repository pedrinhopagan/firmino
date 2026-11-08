import { XMarkIcon } from "@heroicons/react/16/solid"
import { useMutation } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import { useEffect, useRef } from "react"
import firminoMark from "@resources/icon.svg"
import type { Appointment } from "@src/shared/appointment"
import type { EngineClient } from "../engine-client"
import { IconButton } from "../ui/icon-button"
import { AppointmentCard, CompleteButton, useNow } from "./appointment-card"
import { appointmentStore } from "./appointment-events"

/** Alerted and not closed since, while pending. */
function alerting(appointment: Appointment) {
  return appointment.status === "pending" && !!appointment.alertedAt && (!appointment.dismissedAt || appointment.dismissedAt < appointment.alertedAt)
}

/** Two short rising tones, made on the spot so the app ships no sound file. */
function chime() {
  const audio = new AudioContext()

  for (const [index, frequency] of [880, 1318.5].entries()) {
    const start = audio.currentTime + index * 0.16
    const tone = audio.createOscillator()
    const volume = audio.createGain()
    tone.frequency.value = frequency
    volume.gain.setValueAtTime(0.0001, start)
    volume.gain.exponentialRampToValueAtTime(0.2, start + 0.02)
    volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.6)
    tone.connect(volume).connect(audio.destination)
    tone.start(start)
    tone.stop(start + 0.6)
  }

  setTimeout(() => void audio.close(), 1_500)
}

/** Chimes once for every alert it has not shown yet, the first ones included. */
function useChime(shown: Appointment[] | undefined) {
  const heard = useRef(new Set<string>())

  useEffect(() => {
    const fresh = shown?.filter((appointment) => !heard.current.has(`${appointment.id}:${appointment.alertedAt}`)) ?? []

    for (const appointment of fresh) {
      heard.current.add(`${appointment.id}:${appointment.alertedAt}`)
    }

    if (fresh.length > 0) {
      chime()
    }
  }, [shown])
}

/** The alert window's root: the alerting cards over every other window, which Main sizes to them and closes when none is left. */
export function AppointmentToast({ client }: { client: EngineClient }) {
  const now = useNow()
  const shown = useStore(appointmentStore, (state) => state.appointments)?.filter(alerting)
  const dismiss = useMutation({ mutationFn: (id: string) => client.appointments.dismiss({ id }) })
  useChime(shown)

  useEffect(() => {
    if (shown?.length === 0) {
      void window.desktop.closeToast()
    }
  }, [shown?.length])

  function fit(panel: HTMLDivElement | null) {
    if (!panel) {
      return
    }

    const observer = new ResizeObserver(() => void window.desktop.resizeToast(Math.ceil(panel.getBoundingClientRect().height)))
    observer.observe(panel)

    return () => observer.disconnect()
  }

  if (!shown?.length) {
    return null
  }

  return (
    <div ref={fit} className="p-3">
      <section className="flex flex-col gap-2 rounded-xl border bg-popover p-2 text-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)]" aria-label="Compromissos">
        <p className="m-0 flex items-center gap-1.5 px-1 pt-0.5 text-2xs text-muted-foreground">
          <img className="size-3.5" src={firminoMark} alt="" />
          Firmino
        </p>
        {shown.map((appointment) => (
          <AppointmentCard key={appointment.id} appointment={appointment} now={now} onOpen={() => void window.desktop.openAppointment(appointment.id)}>
            <CompleteButton client={client} appointment={appointment} />
            <IconButton className="-mr-1.5" label="Fechar o aviso" tooltipPlacement="left" disabled={dismiss.isPending} onClick={() => dismiss.mutate(appointment.id)}>
              <XMarkIcon aria-hidden="true" />
            </IconButton>
          </AppointmentCard>
        ))}
      </section>
    </div>
  )
}
