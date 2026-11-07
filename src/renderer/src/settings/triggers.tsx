import { TrashIcon } from "@heroicons/react/16/solid"
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef } from "react"
import type { Trigger } from "@src/shared/trigger"
import type { EngineClient } from "../engine-client"
import { ConfirmDialog } from "../ui/confirm-dialog"
import { IconButton } from "../ui/icon-button"
import { SettingsSection, settingsErrorClassName, settingsGroupClassName, settingsNoteClassName } from "../ui/settings-section"
import { Switch } from "../ui/switch"

/** The agent changes Gatilhos in the conversation, so the page reads them again each time it opens. */
const triggersQuery = (client: EngineClient) => queryOptions({ queryKey: ["triggers"], queryFn: () => client.triggers.list(), staleTime: 0 })

const sourceNames: Record<Trigger["source"], string> = { whatsapp: "WhatsApp", email: "Gmail" }
const list = new Intl.ListFormat("pt-BR", { type: "conjunction" })

export function Triggers({ client }: { client: EngineClient }) {
  const { data, error } = useQuery(triggersQuery(client))

  return (
    <SettingsSection title="Seus gatilhos" description="O Kolega age quando chega mensagem de uma conversa ou de um remetente que você escolheu. Para criar ou mudar um gatilho, peça na conversa.">
      <div className={settingsGroupClassName}>
        {!data && !error && <p className={settingsNoteClassName}>Carregando os gatilhos…</p>}
        {error && <p className={settingsErrorClassName} role="alert">{error.message}</p>}
        {data?.length === 0 && <p className={settingsNoteClassName}>Nenhum gatilho. Peça na conversa, como “quando o João mandar mensagem, me avise”.</p>}
        {data?.map((trigger) => <TriggerRow key={trigger.id} client={client} trigger={trigger} />)}
      </div>
    </SettingsSection>
  )
}

/** One Gatilho: it pauses and resumes, and removing it asks first. */
function TriggerRow({ client, trigger }: { client: EngineClient; trigger: Trigger }) {
  const queryClient = useQueryClient()
  const confirm = useRef<HTMLDialogElement>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["triggers"] })
  const { mutate: setEnabled, isPending: switching, error: switchError } = useMutation({ mutationFn: (enabled: boolean) => client.triggers.setEnabled({ id: trigger.id, enabled }), onSuccess: refresh })
  const { mutate: remove, isPending: removing, error: removeError } = useMutation({ mutationFn: () => client.triggers.remove({ id: trigger.id }), onSuccess: refresh })
  const listened = `${sourceNames[trigger.source]}: ${list.format(trigger.targets.map((target) => target.name))}`
  const error = switchError ?? removeError

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className={`flex min-w-0 flex-1 flex-col gap-0.5 ${trigger.status === "paused" ? "opacity-64" : ""}`}>
          <p className="m-0 truncate text-sm font-medium text-foreground" title={trigger.name}>{trigger.name}</p>
          <p className="m-0 truncate text-xs text-muted-foreground" title={listened}>{listened}</p>
          <p className="m-0 text-xs text-muted-foreground">{trigger.canSend ? "Pode responder por você" : "Só avisa você"}</p>
        </div>
        <IconButton label={`Remover ${trigger.name}`} disabled={removing} onClick={() => confirm.current?.showModal()}>
          <TrashIcon aria-hidden="true" />
        </IconButton>
        <Switch label={`Gatilho ${trigger.name} ativo`} checked={trigger.status === "active"} disabled={switching} onChange={setEnabled} />
      </div>
      <p className="m-0 line-clamp-2 text-xs text-muted-foreground" title={trigger.instruction}>{trigger.instruction}</p>
      {error && <p className="m-0 text-xs text-destructive-foreground" role="alert">{error.message}</p>}
      <ConfirmDialog
        ref={confirm}
        title={`Remover o gatilho “${trigger.name}”?`}
        description="O Kolega não vai mais agir quando essas mensagens chegarem. Para criar de novo, peça na conversa."
        confirmLabel="Remover"
        onConfirm={() => remove()}
      />
    </div>
  )
}
