import { useStore } from "@tanstack/react-store"
import type { Appointment } from "@src/shared/appointment"
import { CompleteButton, isLate, scheduledText, useNow, whenText } from "../appointments/appointment-card"
import { appointmentStore } from "../appointments/appointment-events"
import type { EngineClient } from "../engine-client"
import { SettingsSection, settingsGroupClassName, settingsNoteClassName } from "../ui/settings-section"
import { useMenuNavigation } from "./menu-navigation"

export function Appointments({ client }: { client: EngineClient }) {
  const appointments = useStore(appointmentStore, (state) => state.appointments)
  const pending = appointments?.filter((appointment) => appointment.status === "pending")
  const done = appointments?.filter((appointment) => appointment.status === "done").toReversed()

  return (
    <>
      <SettingsSection title="Pendentes" description="O que você precisa fazer. O card aparece acima da conversa e fica até você concluir. Para marcar um compromisso, peça na conversa.">
        <div className={settingsGroupClassName}>
          {!appointments && <p className={settingsNoteClassName}>Carregando os compromissos…</p>}
          {pending?.length === 0 && <p className={settingsNoteClassName}>Nada pendente. Peça na conversa, como “dia 17 às 9h tenho reunião com a Ana”.</p>}
          {pending?.map((appointment) => <AppointmentRow key={appointment.id} client={client} appointment={appointment} />)}
        </div>
      </SettingsSection>
      {!!done?.length && (
        <SettingsSection title="Concluídos">
          <div className={settingsGroupClassName}>
            {done.map((appointment) => <AppointmentRow key={appointment.id} client={client} appointment={appointment} />)}
          </div>
        </SettingsSection>
      )}
    </>
  )
}

/** One Compromisso: clicking it opens its screen, where it can be removed; a pending one can be done right here. */
function AppointmentRow({ client, appointment }: { client: EngineClient; appointment: Appointment }) {
  const now = useNow()
  const navigation = useMenuNavigation()
  const pending = appointment.status === "pending"
  const late = pending && isLate(appointment, now)

  return (
    <div className="flex items-center gap-2 py-1.5 pr-3 pl-1.5">
      <button type="button" className={`flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-1.5 py-1 text-left outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${pending ? "" : "opacity-64"}`} title={appointment.title} data-screen={`appointment:${appointment.id}`} onClick={() => navigation.push(`appointment:${appointment.id}`)}>
        <span className="truncate text-sm font-medium text-foreground">{appointment.title}</span>
        <span className={`truncate text-xs ${late ? "text-destructive-foreground" : "text-muted-foreground"}`}>{pending ? whenText(appointment, now) : `Concluído · ${scheduledText(appointment, now)}`}</span>
      </button>
      {pending && <CompleteButton client={client} appointment={appointment} />}
    </div>
  )
}
