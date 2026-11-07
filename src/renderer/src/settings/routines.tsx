import { TrashIcon } from "@heroicons/react/16/solid"
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef } from "react"
import type { Frequency, Routine, Weekday } from "@src/shared/routine"
import type { EngineClient } from "../engine-client"
import { ConfirmDialog } from "../ui/confirm-dialog"
import { IconButton } from "../ui/icon-button"
import { SettingsSection, settingsErrorClassName, settingsGroupClassName, settingsNoteClassName } from "../ui/settings-section"
import { Switch } from "../ui/switch"

/** Every Rotina, repeating and one-time: the agent changes them in the conversation, so each page reads them again when it opens. */
const routinesQuery = (client: EngineClient) => queryOptions({ queryKey: ["routines"], queryFn: () => client.routines.list(), staleTime: 0 })

/** In week order, from Monday. */
const dayNames: Record<Weekday, string> = { monday: "seg", tuesday: "ter", wednesday: "qua", thursday: "qui", friday: "sex", saturday: "sáb", sunday: "dom" }
const dayRanges: Record<string, string> = { "seg ter qua qui sex sáb dom": "Todo dia", "seg ter qua qui sex": "Seg a sex", "sáb dom": "Sáb e dom" }
const list = new Intl.ListFormat("pt-BR", { type: "conjunction" })
const timeOfDay = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" })
const calendarDay = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short" })
const relativeDay = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" })
const dayMs = 86_400_000
const onceStatus: Record<Routine["status"], string> = { active: "", paused: "Pausado", completed: "Concluído", failed: "Falhou" }

function capitalized(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function daysText(days: Weekday[]) {
  const chosen = new Set(days.map((day) => dayNames[day]))
  const ordered = Object.values(dayNames).filter((name) => chosen.has(name))

  return dayRanges[ordered.join(" ")] ?? capitalized(list.format(ordered))
}

function durationText(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60

  return [hours > 0 && `${hours} h`, rest > 0 && `${rest} min`].filter(Boolean).join(" ")
}

function scheduleText(frequency: Exclude<Frequency, { form: "once" }>) {
  if (frequency.form === "fixed-time") {
    return `${daysText(frequency.days)} às ${list.format(frequency.times)}`
  }

  const allDay = frequency.startTime === "00:00" && frequency.endTime === "23:59"

  return `${daysText(frequency.days)}, a cada ${durationText(frequency.everyMinutes)}${allDay ? "" : `, das ${frequency.startTime} às ${frequency.endTime}`}`
}

/** "hoje, 09:00", "amanhã, 14:30", or the weekday and date further away. */
function whenText(iso: string) {
  const date = new Date(iso)
  const now = new Date()
  const days = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / dayMs)
  const day = Math.abs(days) <= 1 ? relativeDay.format(days, "day") : calendarDay.format(date)

  return `${day}, ${timeOfDay.format(date)}`
}

/** What the row says about when a Rotina runs: its date and how it ended, or its schedule and next run. */
function timing(routine: Routine) {
  if (routine.frequency.form === "once") {
    return [capitalized(whenText(routine.frequency.at)), onceStatus[routine.status]]
  }

  return [scheduleText(routine.frequency), routine.nextRunAt ? `Próxima: ${whenText(routine.nextRunAt)}` : "Pausada"]
}

export function Routines({ client }: { client: EngineClient }) {
  const { data, error } = useQuery(routinesQuery(client))
  const repeating = data?.filter((routine) => routine.frequency.form !== "once")

  return (
    <SettingsSection title="Suas rotinas" description="Tarefas que o Kolega repete sozinho. Para criar ou mudar uma rotina, peça na conversa.">
      <div className={settingsGroupClassName}>
        {!data && !error && <p className={settingsNoteClassName}>Carregando as rotinas…</p>}
        {error && <p className={settingsErrorClassName} role="alert">{error.message}</p>}
        {repeating?.length === 0 && <p className={settingsNoteClassName}>Nenhuma rotina. Peça na conversa, como “todo dia às 9h, me lembre de beber água”.</p>}
        {repeating?.map((routine) => <RoutineRow key={routine.id} client={client} routine={routine} />)}
      </div>
    </SettingsSection>
  )
}

export function Schedules({ client }: { client: EngineClient }) {
  const { data, error } = useQuery(routinesQuery(client))
  const once = (data ?? []).flatMap((routine) => routine.frequency.form === "once" ? [{ routine, at: routine.frequency.at }] : [])
  const upcoming = once.filter(({ routine }) => routine.status === "active" || routine.status === "paused").toSorted((a, b) => a.at.localeCompare(b.at))
  const past = once.filter(({ routine }) => routine.status === "completed" || routine.status === "failed").toSorted((a, b) => b.at.localeCompare(a.at))

  return (
    <>
      <SettingsSection title="Próximos" description="Tarefas que o Kolega faz uma vez, no horário marcado. Para marcar uma, peça na conversa.">
        <div className={settingsGroupClassName}>
          {!data && !error && <p className={settingsNoteClassName}>Carregando os agendamentos…</p>}
          {error && <p className={settingsErrorClassName} role="alert">{error.message}</p>}
          {data && upcoming.length === 0 && <p className={settingsNoteClassName}>Nada marcado. Peça na conversa, como “daqui a 2 horas, me lembre de ligar para o João”.</p>}
          {upcoming.map(({ routine }) => <RoutineRow key={routine.id} client={client} routine={routine} />)}
        </div>
      </SettingsSection>
      {past.length > 0 && (
        <SettingsSection title="Anteriores">
          <div className={settingsGroupClassName}>
            {past.map(({ routine }) => <RoutineRow key={routine.id} client={client} routine={routine} />)}
          </div>
        </SettingsSection>
      )}
    </>
  )
}

/** One Rotina: a repeating one pauses and resumes; removing one that would still run asks first. */
function RoutineRow({ client, routine }: { client: EngineClient; routine: Routine }) {
  const queryClient = useQueryClient()
  const confirm = useRef<HTMLDialogElement>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["routines"] })
  const { mutate: setEnabled, isPending: switching, error: switchError } = useMutation({ mutationFn: (enabled: boolean) => client.routines.setEnabled({ id: routine.id, enabled }), onSuccess: refresh })
  const { mutate: remove, isPending: removing, error: removeError } = useMutation({ mutationFn: () => client.routines.remove({ id: routine.id }), onSuccess: refresh })
  const once = routine.frequency.form === "once"
  const pending = routine.status === "active" || routine.status === "paused"
  const [when, state] = timing(routine)
  const error = switchError ?? removeError

  function handleRemove() {
    if (!pending) {
      remove()

      return
    }

    confirm.current?.showModal()
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className={`flex min-w-0 flex-1 flex-col gap-0.5 ${routine.status === "paused" ? "opacity-64" : ""}`}>
          <p className="m-0 truncate text-sm font-medium text-foreground" title={routine.name}>{routine.name}</p>
          <p className="m-0 text-xs text-muted-foreground">{when}</p>
          {state && <p className={`m-0 text-xs ${routine.status === "failed" ? "text-destructive-foreground" : "text-muted-foreground"}`}>{state}</p>}
        </div>
        <IconButton label={`Remover ${routine.name}`} disabled={removing} onClick={handleRemove}>
          <TrashIcon aria-hidden="true" />
        </IconButton>
        {!once && <Switch label={`Rotina ${routine.name} ativa`} checked={routine.status === "active"} disabled={switching} onChange={setEnabled} />}
      </div>
      <p className="m-0 line-clamp-2 text-xs text-muted-foreground" title={routine.prompt}>{routine.prompt}</p>
      {error && <p className="m-0 text-xs text-destructive-foreground" role="alert">{error.message}</p>}
      <ConfirmDialog
        ref={confirm}
        title={`Remover ${once ? "o agendamento" : "a rotina"} “${routine.name}”?`}
        description={`O Kolega não vai mais executá-${once ? "lo" : "la"}. Para ${once ? "marcar" : "criar"} de novo, peça na conversa.`}
        confirmLabel="Remover"
        onConfirm={() => remove()}
      />
    </div>
  )
}
