import { CheckIcon, TrashIcon } from "@heroicons/react/16/solid"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import type { StoredMemory } from "@src/shared/memory"
import type { EngineClient } from "../engine-client"
import { Button } from "../ui/button"
import { ConfirmDialog } from "../ui/confirm-dialog"
import { IconButton } from "../ui/icon-button"
import { SettingsRow, SettingsSection, settingsErrorClassName, settingsGroupClassName } from "../ui/settings-section"

/** The agent notes and forgets memories in the conversation, so the page reads them again when it opens. */
const memoryKey = ["memory"]
const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })

function countLabel(count?: number) {
  if (count === undefined) {
    return "Contando as memórias…"
  }

  if (count === 0) {
    return "Nenhuma memória guardada"
  }

  if (count === 1) {
    return "1 memória guardada"
  }

  return `${count} memórias guardadas`
}

export function MemorySettings({ client }: { client: EngineClient }) {
  const queryClient = useQueryClient()
  const confirm = useRef<HTMLDialogElement>(null)
  const { data, error } = useQuery({ queryKey: memoryKey, queryFn: () => client.memory.list(), staleTime: 0 })
  const { mutate: clear, isPending: clearing, isSuccess: cleared, error: clearError } = useMutation({
    mutationFn: () => client.memory.clear(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: memoryKey }),
  })

  return (
    <>
      <SettingsSection title="O que o Firmino lembra" description="O Firmino anota o que aprende sobre você e relê essas anotações a cada conversa. Para ele esquecer algo, peça na conversa ou apague aqui.">
        <div className={settingsGroupClassName}>
          <SettingsRow title={countLabel(data?.length)} description={<span role="status">{cleared ? "Memória limpa. O histórico da conversa continua." : "Limpar não apaga o histórico da conversa."}</span>}>
            <Button variant="danger" disabled={!data?.length || clearing} onClick={() => confirm.current?.showModal()}>Limpar memória</Button>
          </SettingsRow>
          {(error ?? clearError) && <p className={settingsErrorClassName} role="alert">{(error ?? clearError)?.message}</p>}
        </div>
        <ConfirmDialog ref={confirm} title="Limpar a memória?" description="O Firmino esquece tudo o que anotou sobre você. Não dá para desfazer." confirmLabel="Limpar memória" onConfirm={() => clear()} />
      </SettingsSection>
      {!!data?.length && (
        <SettingsSection title="Memórias">
          <div className={settingsGroupClassName}>
            {data.toReversed().map((memory) => <MemoryRow key={memory.id} client={client} memory={memory} />)}
          </div>
        </SettingsSection>
      )}
    </>
  )
}

/** One memory. The trash button turns into a confirm button; a second click forgets it. Moving the pointer or the focus away cancels, since a click does not focus a button everywhere. */
function MemoryRow({ client, memory }: { client: EngineClient; memory: StoredMemory }) {
  const queryClient = useQueryClient()
  const [armed, setArmed] = useState(false)
  const { mutate: forget, isPending: forgetting, error } = useMutation({
    mutationFn: () => client.memory.forget({ id: memory.id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: memoryKey }),
  })

  function handleClick() {
    if (!armed) {
      setArmed(true)

      return
    }

    forget()
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="m-0 text-sm text-foreground">{memory.text}</p>
          <p className="m-0 text-xs text-muted-foreground">{shortDate.format(new Date(memory.date))}</p>
        </div>
        <IconButton
          label={armed ? "Clique de novo para apagar" : "Apagar memória"}
          className={armed ? "text-destructive-foreground! hover:bg-destructive/8!" : undefined}
          disabled={forgetting}
          onClick={handleClick}
          onBlur={() => setArmed(false)}
          onPointerLeave={() => setArmed(false)}
        >
          {armed ? <CheckIcon aria-hidden="true" /> : <TrashIcon aria-hidden="true" />}
        </IconButton>
      </div>
      {error && <p className="m-0 text-xs text-destructive-foreground" role="alert">{error.message}</p>}
    </div>
  )
}
