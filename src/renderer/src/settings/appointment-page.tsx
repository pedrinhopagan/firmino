import { useMutation } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import { useRef } from "react"
import { isLate, remindText, useNow, whenText } from "../appointments/appointment-card"
import { appointmentStore } from "../appointments/appointment-events"
import type { EngineClient } from "../engine-client"
import { Button } from "../ui/button"
import { ConfirmDialog } from "../ui/confirm-dialog"
import { SettingsRow, settingsGroupClassName, settingsNoteClassName } from "../ui/settings-section"
import { useMenuNavigation } from "./menu-navigation"

/** One Compromisso on its own screen: its title in full, when it is and its alert, with Concluir and Remover. */
export function AppointmentPage({ client, id }: { client: EngineClient; id: string }) {
  const now = useNow()
  const navigation = useMenuNavigation()
  const confirm = useRef<HTMLDialogElement>(null)
  const appointments = useStore(appointmentStore, (state) => state.appointments)
  const appointment = appointments?.find((candidate) => candidate.id === id)
  const complete = useMutation({ mutationFn: () => client.appointments.complete({ id }) })
  const remove = useMutation({ mutationFn: () => client.appointments.remove({ id }), onSuccess: () => navigation.back() })
  const error = complete.error ?? remove.error

  if (!appointment) {
    return <p className={settingsNoteClassName}>{appointments ? "Este compromisso foi removido." : "Carregando o compromisso…"}</p>
  }

  const pending = appointment.status === "pending"
  const late = pending && isLate(appointment, now)

  return (
    <>
      <h2 className="m-0 px-1 text-base leading-snug font-medium text-foreground [overflow-wrap:anywhere]">{appointment.title}</h2>
      <div className={settingsGroupClassName}>
        <SettingsRow title="Quando" description={<span className={late ? "text-destructive-foreground" : ""}>{whenText(appointment, now)}</span>} />
        <SettingsRow title="Aviso" description={remindText(appointment)} />
        <SettingsRow title="Situação" description={pending ? "Pendente" : "Concluído"} />
      </div>
      {error && <p className="m-0 px-1 text-xs text-destructive-foreground" role="alert">{error.message}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="danger" disabled={remove.isPending} onClick={() => confirm.current?.showModal()}>Remover</Button>
        {pending && <Button disabled={complete.isPending} onClick={() => complete.mutate()}>Concluir</Button>}
      </div>
      <ConfirmDialog
        ref={confirm}
        title={`Remover o compromisso “${appointment.title}”?`}
        description="O Kolega não vai mais mostrar nem avisar sobre ele. Para marcar de novo, peça na conversa."
        confirmLabel="Remover"
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}
