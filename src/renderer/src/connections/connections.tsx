import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import { QRCodeSVG } from "qrcode.react"
import type { GoogleStatus } from "@src/shared/google"
import type { WhatsappStatus } from "@src/shared/whatsapp"
import type { EngineClient } from "../engine-client"
import { Button } from "../ui/button"
import { googleStore } from "./google-events"
import { whatsappStore } from "./whatsapp-events"

const sectionClassName = "flex flex-col gap-3 rounded-xl border border-outline p-4"

const stateLabels: Record<WhatsappStatus["state"], string> = {
  unlinked: "Não conectado",
  linking: "Aguardando a leitura do código",
  connecting: "Conectando",
  connected: "Conectado",
}

export function Connections({ client }: { client: EngineClient }) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-6 pt-16 pb-8">
        <h1 className="m-0 mb-2 text-title font-semibold">Conexões</h1>
        <WhatsappConnection client={client} />
        <GoogleConnection client={client} />
        <ZenConnection client={client} />
      </div>
    </div>
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
    <section className={sectionClassName} aria-labelledby="whatsapp-title">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="whatsapp-title" className="m-0 text-section font-medium">WhatsApp</h2>
          <p className="m-0 text-support text-muted" role="status">{stateLabels[status.state]}{account(status)}</p>
        </div>
        {status.state === "unlinked"
          ? <Button disabled={link.isPending} onClick={() => link.mutate()}>Conectar</Button>
          : <Button variant="danger" disabled={unlink.isPending} onClick={() => unlink.mutate()}>{status.state === "linking" ? "Cancelar" : "Desconectar"}</Button>}
      </div>
      {status.state === "unlinked" && status.error && <p className="m-0 text-support text-status-error" role="alert">{status.error}</p>}
      {(link.error ?? unlink.error) && <p className="m-0 text-support text-status-error" role="alert">{(link.error ?? unlink.error)?.message}</p>}
      {status.state === "linking" && <LinkCode code={status.qr} />}
    </section>
  )
}

function LinkCode({ code }: { code?: string }) {
  if (!code) {
    return <p className="m-0 text-support text-muted">Gerando o código…</p>
  }

  return (
    <div className="flex flex-col items-center gap-3 self-start rounded-lg border border-outline p-4">
      <div className="rounded-md bg-primary p-3">
        <QRCodeSVG value={code} size={208} marginSize={0} bgColor="transparent" fgColor="var(--color-canvas)" title="Código para conectar o WhatsApp" />
      </div>
      <div className="flex max-w-56 flex-col gap-1">
        <p className="m-0 text-center text-support text-secondary">No celular, abra o WhatsApp, vá em Aparelhos conectados e leia o código.</p>
        <p className="m-0 text-center text-support text-muted">O WhatsApp não autoriza clientes de terceiros. A conta pode ser bloqueada.</p>
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
    <section className={sectionClassName} aria-labelledby="google-title">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="google-title" className="m-0 text-section font-medium">Google</h2>
          <p className="m-0 text-support text-muted" role="status">{googleLabels[status.state]}{status.state === "connected" ? ` · ${status.account}` : ""}</p>
        </div>
        {status.state === "disconnected"
          ? <Button disabled={connect.isPending} onClick={() => connect.mutate()}>Conectar Google</Button>
          : <Button variant="danger" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>{status.state === "connecting" ? "Cancelar" : "Desconectar"}</Button>}
      </div>
      <p className="m-0 text-support text-secondary">Gmail e Google Agenda, com uma permissão só.</p>
      {status.state === "connecting" && <p className="m-0 text-support text-muted">A página de permissão do Google abriu no seu navegador.</p>}
      {status.state === "disconnected" && status.error && <p className="m-0 text-support text-status-error" role="alert">{status.error}</p>}
      {(connect.error ?? disconnect.error) && <p className="m-0 text-support text-status-error" role="alert">{(connect.error ?? disconnect.error)?.message}</p>}
    </section>
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
    <section className={sectionClassName} aria-labelledby="zen-title">
      <div className="flex flex-col gap-0.5">
        <h2 id="zen-title" className="m-0 text-section font-medium">Conta do Zen</h2>
        <p className="m-0 text-support text-secondary">O navegador do Kolega entra nos sites com os cookies desta conta. Ele lê uma cópia e nunca altera o Zen.</p>
      </div>
      {identities.isPending && <p className="m-0 text-support text-muted">Lendo o perfil do Zen…</p>}
      {identities.error && <p className="m-0 text-support text-status-error" role="alert">Não foi possível ler o perfil do Zen: {identities.error.message}</p>}
      {identities.data?.length === 0 && <p className="m-0 text-support text-muted">Nenhuma conta do Zen com cookies neste computador.</p>}
      {!!identities.data?.length && (
        <fieldset className="m-0 flex flex-col gap-0.5 border-0 p-0">
          <legend className="sr-only">Conta do Zen</legend>
          {identities.data.map((identity) => (
            <label key={identity.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-control text-secondary transition-colors duration-150 hover:bg-surface-hover hover:text-primary has-checked:bg-surface-active has-checked:text-primary has-focus-visible:ring-1 has-focus-visible:ring-ring has-disabled:pointer-events-none">
              <input className="sr-only" type="radio" name="zen-identity" value={identity.id} checked={current === identity.id} disabled={choose.isPending} onChange={() => choose.mutate(identity.id)} />
              <span>{identity.name}</span>
              <span className="text-metadata text-muted tabular-nums">{cookieCount.format(identity.cookies)} cookies</span>
            </label>
          ))}
        </fieldset>
      )}
      {!!identities.data?.length && current === undefined && identities.data.length > 1 && <p className="m-0 text-support text-muted">Escolha uma conta para o navegador entrar nos sites com ela.</p>}
      {choose.isSuccess && <p className="m-0 text-support text-muted" role="status">O Kolega usa esta conta na próxima vez que importar os cookies do Zen.</p>}
      {choose.error && <p className="m-0 text-support text-status-error" role="alert">{choose.error.message}</p>}
    </section>
  )
}
