import { useMutation } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import { QRCodeSVG } from "qrcode.react"
import type { WhatsappStatus } from "@src/shared/whatsapp"
import type { EngineClient } from "../engine-client"
import { whatsappStore } from "./whatsapp-events"

const stateLabels: Record<WhatsappStatus["state"], string> = {
  unlinked: "Não conectado",
  linking: "Aguardando a leitura do código",
  connecting: "Conectando",
  connected: "Conectado",
}

export function Connections({ client }: { client: EngineClient }) {
  return (
    <div className="flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-6 overflow-y-auto px-6 pt-14 pb-6">
      <h1 className="m-0 text-title font-semibold">Conexões</h1>
      <WhatsappConnection client={client} />
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
    <section className="flex flex-col gap-3 rounded-2xl border border-outline bg-surface p-4" aria-labelledby="whatsapp-title">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="whatsapp-title" className="m-0 text-section font-medium">WhatsApp</h2>
          <p className="m-0 text-support text-muted" role="status">{stateLabels[status.state]}{account(status)}</p>
        </div>
        {status.state === "unlinked"
          ? <button className="rounded-xl bg-accent px-4 py-2 text-control font-medium text-accent-ink hover:bg-primary disabled:opacity-40" type="button" disabled={link.isPending} onClick={() => link.mutate()}>Conectar</button>
          : <button className="rounded-xl border border-outline-strong px-4 py-2 text-control text-status-error hover:bg-surface-hover disabled:opacity-40" type="button" disabled={unlink.isPending} onClick={() => unlink.mutate()}>{status.state === "linking" ? "Cancelar" : "Desconectar"}</button>}
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
