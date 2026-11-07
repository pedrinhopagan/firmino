import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import { QRCodeSVG } from "qrcode.react"
import type { GoogleStatus } from "@src/shared/google"
import type { WhatsappStatus } from "@src/shared/whatsapp"
import type { EngineClient } from "../engine-client"
import { Button } from "../ui/button"
import { SettingsRow, SettingsSection, settingsErrorClassName, settingsGroupClassName, settingsNoteClassName } from "../ui/settings-section"
import { DiscordConnection } from "./discord-connection"
import { googleStore } from "./google-events"
import { whatsappStore } from "./whatsapp-events"

const stateLabels: Record<WhatsappStatus["state"], string> = {
  unlinked: "Não conectado",
  linking: "Aguardando a leitura do código",
  connecting: "Conectando",
  connected: "Conectado",
}

export function Connections({ client }: { client: EngineClient }) {
  return (
    <>
      <SettingsSection title="Serviços">
        <div className={settingsGroupClassName}>
          <WhatsappConnection client={client} />
          <GoogleConnection client={client} />
          <DiscordConnection client={client} />
        </div>
      </SettingsSection>
      <ZenConnection client={client} />
    </>
  )
}

function account(status: WhatsappStatus) {
  if ((status.state === "connected" || status.state === "connecting") && status.account) {
    return ` · +${status.account}`
  }

  return ""
}

function WhatsappConnection({ client }: { client: EngineClient }) {
  const status = useStore(whatsappStore, (state) => state.status)
  const link = useMutation({ mutationFn: () => client.whatsapp.link() })
  const unlink = useMutation({ mutationFn: () => client.whatsapp.unlink() })

  if (!status) {
    return null
  }

  return (
    <div className="flex flex-col">
      <SettingsRow title="WhatsApp" description={<span role="status">{stateLabels[status.state]}{account(status)}</span>}>
        {status.state === "unlinked"
          ? <Button variant="secondary" disabled={link.isPending} onClick={() => link.mutate()}>Conectar</Button>
          : <Button variant="danger" disabled={unlink.isPending} onClick={() => unlink.mutate()}>{status.state === "linking" ? "Cancelar" : "Desconectar"}</Button>}
      </SettingsRow>
      {status.state === "unlinked" && status.error && <p className={settingsErrorClassName} role="alert">{status.error}</p>}
      {(link.error ?? unlink.error) && <p className={settingsErrorClassName} role="alert">{(link.error ?? unlink.error)?.message}</p>}
      {status.state === "linking" && <LinkCode code={status.qr} />}
    </div>
  )
}

function LinkCode({ code }: { code?: string }) {
  if (!code) {
    return <p className={settingsNoteClassName}>Gerando o código…</p>
  }

  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <div className="rounded-md bg-white p-3">
        <QRCodeSVG value={code} size={208} marginSize={0} bgColor="transparent" fgColor="#000000" title="Código para conectar o WhatsApp" />
      </div>
      <div className="flex max-w-60 flex-col gap-1">
        <p className="m-0 text-center text-xs text-foreground">No celular, abra o WhatsApp, vá em Aparelhos conectados e leia o código.</p>
        <p className="m-0 text-center text-xs text-muted-foreground">O WhatsApp não autoriza clientes de terceiros. A conta pode ser bloqueada.</p>
      </div>
    </div>
  )
}

const googleLabels: Record<GoogleStatus["state"], string> = {
  disconnected: "Não conectado",
  connecting: "Aguardando a permissão no navegador",
  connected: "Conectado",
}

function GoogleConnection({ client }: { client: EngineClient }) {
  const status = useStore(googleStore, (state) => state.status)
  const connect = useMutation({ mutationFn: () => client.google.connect() })
  const disconnect = useMutation({ mutationFn: () => client.google.disconnect() })

  if (!status) {
    return null
  }

  return (
    <div className="flex flex-col">
      <SettingsRow title="Gmail e Google Agenda" description={<span role="status">{googleLabels[status.state]}{status.state === "connected" ? ` · ${status.account}` : ""}</span>}>
        {status.state === "disconnected"
          ? <Button variant="secondary" disabled={connect.isPending} onClick={() => connect.mutate()}>Conectar</Button>
          : <Button variant="danger" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>{status.state === "connecting" ? "Cancelar" : "Desconectar"}</Button>}
      </SettingsRow>
      {status.state === "connecting" && <p className={settingsNoteClassName}>A página de permissão do Google abriu no seu navegador.</p>}
      {status.state === "disconnected" && status.error && <p className={settingsErrorClassName} role="alert">{status.error}</p>}
      {(connect.error ?? disconnect.error) && <p className={settingsErrorClassName} role="alert">{(connect.error ?? disconnect.error)?.message}</p>}
    </div>
  )
}

const cookieCount = new Intl.NumberFormat("pt-BR")

/** The Zen account the browser takes its logins from: Main counts the cookies of each, the Engine keeps the choice. */
function ZenConnection({ client }: { client: EngineClient }) {
  const queryClient = useQueryClient()
  const identities = useQuery({ queryKey: ["zen", "identities"], queryFn: () => window.desktop.zenIdentities() })
  const chosen = useQuery({ queryKey: ["zen", "identity"], queryFn: () => client.zen.identity() })
  const choose = useMutation({
    mutationFn: (identity: number) => client.zen.choose({ identity }),
    onSuccess: (_result, identity) => queryClient.setQueryData(["zen", "identity"], { identity }),
  })
  const current = choose.isPending ? choose.variables : chosen.data?.identity

  return (
    <SettingsSection title="Navegador" description="O navegador do Kolega entra nos sites com os cookies da conta do Zen escolhida. Ele lê uma cópia e nunca altera o Zen.">
      <div className={settingsGroupClassName}>
        {identities.isPending && <p className={settingsNoteClassName}>Lendo o perfil do Zen…</p>}
        {identities.error && <p className={settingsErrorClassName} role="alert">Não foi possível ler o perfil do Zen: {identities.error.message}</p>}
        {identities.data?.length === 0 && <p className={settingsNoteClassName}>Nenhuma conta do Zen com cookies neste computador.</p>}
        {!!identities.data?.length && (
          <fieldset className="m-0 flex flex-col border-0 p-0 [&>label+label]:border-t">
            <legend className="sr-only">Conta do Zen</legend>
            {identities.data.map((identity) => (
              <label key={identity.id} className="flex h-10 cursor-pointer items-center gap-3 px-3 text-sm text-foreground transition-colors duration-150 hover:bg-accent/50 has-focus-visible:bg-accent has-disabled:pointer-events-none">
                <input className="peer sr-only" type="radio" name="zen-identity" value={identity.id} checked={current === identity.id} disabled={choose.isPending} onChange={() => choose.mutate(identity.id)} />
                <span className="grid size-4 shrink-0 place-items-center rounded-full border border-input peer-checked:border-primary peer-checked:[&>span]:visible" aria-hidden="true">
                  <span className="invisible size-2 rounded-full bg-primary" />
                </span>
                <span className="min-w-0 flex-1 truncate">{identity.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{cookieCount.format(identity.cookies)} cookies</span>
              </label>
            ))}
          </fieldset>
        )}
        {choose.isSuccess && <p className={settingsNoteClassName} role="status">O Kolega usa esta conta na próxima vez que importar os cookies do Zen.</p>}
        {choose.error && <p className={settingsErrorClassName} role="alert">{choose.error.message}</p>}
      </div>
    </SettingsSection>
  )
}
