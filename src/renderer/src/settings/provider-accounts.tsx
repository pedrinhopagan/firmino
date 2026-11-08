import { TrashIcon } from "@heroicons/react/16/solid"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useRef, useState } from "react"
import type { ProviderId, ProviderStatus } from "@src/shared/conversation"
import { providerNames, ProviderIcon, statusLabel } from "../chat/provider-picker"
import { chatQueries } from "../chat/chat-queries"
import type { EngineClient } from "../engine-client"
import { Button } from "../ui/button"
import { IconButton } from "../ui/icon-button"
import { SettingsSection, settingsErrorClassName, settingsGroupClassName, settingsNoteClassName } from "../ui/settings-section"
import { Switch } from "../ui/switch"

const inputClassName = "h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
/** Each provider's default account has the provider's id; it can be turned off, not removed. */
const defaultAccountIds = new Set<string>(["codex", "claude"])
const homeNames: Record<ProviderId, string> = { codex: "CODEX_HOME", claude: "CLAUDE_CONFIG_DIR" }

/** Refetches the statuses and the active account, which every change here can move. */
function useRefresh() {
  const queryClient = useQueryClient()

  return () => queryClient.invalidateQueries({ queryKey: ["providers"] })
}

/** The provider accounts, as T3 Code's provider instances: each account is a CLI pointed at its own home folder, with its own login. */
export function ProviderAccounts({ client }: { client: EngineClient }) {
  const statuses = useQuery(chatQueries.providers(client))
  const refresh = useRefresh()
  const [adding, setAdding] = useState(false)
  const importT3 = useMutation({ mutationFn: () => client.providers.importT3(), onSuccess: refresh })

  return (
    <SettingsSection title="Contas" description="Cada conta usa a própria pasta do Codex ou do Claude. As contas padrão usam a mesma pasta do terminal e do T3 Code, então o login vale nos dois.">
      <div className={settingsGroupClassName}>
        {statuses.isPending && <p className={settingsNoteClassName}>Verificando as contas…</p>}
        {statuses.error && <p className={settingsErrorClassName} role="alert">{statuses.error.message}</p>}
        {statuses.data?.map((status) => <AccountRow key={status.account.id} client={client} status={status} />)}
        {adding && <AddAccount client={client} onDone={() => setAdding(false)} />}
        {importT3.error && <p className={settingsErrorClassName} role="alert">{importT3.error.message}</p>}
      </div>
      {!adding && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" disabled={importT3.isPending || statuses.isFetching} onClick={() => importT3.mutate()}>Importar do T3 Code</Button>
          <Button variant="secondary" onClick={() => setAdding(true)}>Adicionar conta</Button>
        </div>
      )}
    </SettingsSection>
  )
}

function AccountRow({ client, status }: { client: EngineClient; status: ProviderStatus }) {
  const { account } = status
  const refresh = useRefresh()
  const update = useMutation({ mutationFn: (enabled: boolean) => client.providers.update({ id: account.id, name: account.name, enabled }), onSuccess: refresh })
  const remove = useMutation({ mutationFn: () => client.providers.remove({ id: account.id }), onSuccess: refresh })
  const login = useLogin(client, account.id)
  const canLogin = account.enabled && status.installed && !status.loggedIn
  const error = update.error ?? remove.error

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className={`flex min-w-0 flex-1 items-center gap-3 ${account.enabled ? "" : "opacity-64"}`} title={`${homeNames[account.provider]}: ${account.home ?? `padrão do ${providerNames[account.provider]}`}`}>
          <ProviderIcon provider={account.provider} className="size-5 shrink-0" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="m-0 truncate text-sm font-medium text-foreground">{account.name}</p>
            <p className="m-0 truncate text-xs text-muted-foreground" role="status">{statusLabel(status)}</p>
          </div>
        </div>
        {canLogin && !login.running && <Button variant="secondary" onClick={login.start}>Entrar</Button>}
        {!defaultAccountIds.has(account.id) && (
          <IconButton label={`Remover ${account.name}`} disabled={remove.isPending} onClick={() => remove.mutate()}>
            <TrashIcon aria-hidden="true" />
          </IconButton>
        )}
        <Switch label={`Usar a conta ${account.name}`} checked={account.enabled} disabled={update.isPending} onChange={(enabled) => update.mutate(enabled)} />
      </div>
      {login.running && <LoginInProgress client={client} provider={account.provider} id={account.id} url={login.url} onCancel={login.cancel} />}
      {login.error && <p className={settingsErrorClassName} role="alert">{login.error}</p>}
      {error && <p className={settingsErrorClassName} role="alert">{error.message}</p>}
    </div>
  )
}

/** A sign-in runs while its stream is open; closing the stream cancels it. */
function useLogin(client: EngineClient, id: string) {
  const refresh = useRefresh()
  const controller = useRef<AbortController>(undefined)
  const [url, setUrl] = useState<string>()
  const login = useMutation({
    mutationFn: async () => {
      const aborter = new AbortController()
      controller.current = aborter

      for await (const event of await client.providers.login({ id }, { signal: aborter.signal })) {
        setUrl(event.url)
      }
    },
    onSettled: () => {
      setUrl(undefined)
      void refresh()
    },
  })
  const cancelled = controller.current?.signal.aborted

  return {
    running: login.isPending,
    url,
    error: login.error && !cancelled ? login.error.message : undefined,
    start: () => login.mutate(),
    cancel: () => controller.current?.abort(),
  }
}

function LoginInProgress({ client, provider, id, url, onCancel }: { client: EngineClient; provider: ProviderId; id: string; url?: string; onCancel: () => void }) {
  const [code, setCode] = useState("")
  const send = useMutation({ mutationFn: () => client.providers.loginCode({ id, code }) })

  function submit(event: FormEvent) {
    event.preventDefault()
    send.mutate()
  }

  return (
    <div className="flex flex-col gap-2 px-3 pb-2.5">
      <p className="m-0 text-xs text-muted-foreground" role="status">
        {url ? "A página de login abriu no seu navegador. " : "Abrindo a página de login… "}
        {url && <a className="text-foreground underline underline-offset-2" href={url} target="_blank" rel="noreferrer">Abrir de novo</a>}
      </p>
      {provider === "claude" && url && (
        <form className="flex items-center gap-2" onSubmit={submit}>
          <input className={inputClassName} value={code} placeholder="Cole aqui o código que o Claude mostrou" aria-label="Código do Claude" onChange={(event) => setCode(event.target.value)} />
          <Button type="submit" disabled={!code.trim() || send.isPending}>Enviar</Button>
        </form>
      )}
      {send.error && <p className="m-0 text-xs text-destructive-foreground" role="alert">{send.error.message}</p>}
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onCancel}>Cancelar login</Button>
      </div>
    </div>
  )
}

function AddAccount({ client, onDone }: { client: EngineClient; onDone: () => void }) {
  const refresh = useRefresh()
  const [provider, setProvider] = useState<ProviderId>("codex")
  const [name, setName] = useState("")
  const [home, setHome] = useState("")
  const add = useMutation({
    mutationFn: () => client.providers.add({ provider, name: name.trim(), ...(home.trim() ? { home: home.trim() } : {}) }),
    onSuccess: () => {
      void refresh()
      onDone()
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    add.mutate()
  }

  return (
    <form className="flex flex-col gap-2 px-3 py-2.5" onSubmit={submit} aria-label="Nova conta">
      <div className="grid grid-cols-2 gap-0.5 rounded-lg border bg-muted/40 p-0.5" role="group" aria-label="Fornecedor">
        {(["codex", "claude"] as const).map((option) => (
          <button key={option} type="button" className="flex h-7 items-center justify-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs" aria-pressed={provider === option} onClick={() => setProvider(option)}>
            <ProviderIcon provider={option} className="size-3.5" />
            {providerNames[option]}
          </button>
        ))}
      </div>
      <input className={inputClassName} value={name} placeholder="Nome da conta, como Trabalho" aria-label="Nome da conta" onChange={(event) => setName(event.target.value)} />
      <input className={inputClassName} value={home} placeholder={`${homeNames[provider]} existente (opcional)`} aria-label={`Pasta ${homeNames[provider]}`} onChange={(event) => setHome(event.target.value)} />
      <p className="m-0 text-2xs text-muted-foreground">Sem pasta, o Firmino cria uma pasta nova e você entra com outra conta.</p>
      {add.error && <p className="m-0 text-xs text-destructive-foreground" role="alert">{add.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Cancelar</Button>
        <Button type="submit" disabled={!name.trim() || add.isPending}>Adicionar</Button>
      </div>
    </form>
  )
}
