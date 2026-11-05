import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import { type FormEvent, type KeyboardEvent, useState } from "react"
import type { ConversationMessage, ProviderChoice, ProviderId, ProviderStatus } from "@src/shared/conversation"
import type { EngineClient } from "../engine-client"
import { chatQueries } from "./chat-queries"
import { chatStore } from "./chat-store"

const providerNames: Record<ProviderId, string> = { codex: "Codex", claude: "Claude" }

export function Chat({ client }: { client: EngineClient }) {
  return (
    <div className="flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3 px-6 pt-14 pb-6">
      <ProviderPicker client={client} />
      <Messages client={client} />
      <Composer client={client} />
    </div>
  )
}

function statusLabel(status: ProviderStatus) {
  if (!status.installed) {
    return "não instalado"
  }

  if (!status.loggedIn) {
    return "sem login"
  }

  if (!status.account) {
    return "conectado"
  }

  return `conectado · ${status.account}`
}

function ProviderPicker({ client }: { client: EngineClient }) {
  const queryClient = useQueryClient()
  const statuses = useQuery(chatQueries.providers(client))
  const active = useQuery(chatQueries.active(client))
  const running = useStore(chatStore, (state) => state.reply !== undefined)
  const choose = useMutation({
    mutationFn: (choice: ProviderChoice) => client.providers.choose(choice),
    onSuccess: (choice) => queryClient.setQueryData(chatQueries.active(client).queryKey, choice),
  })

  if (!active.data) {
    return null
  }

  const choice = active.data
  const models = statuses.data?.find((status) => status.provider === choice.provider)?.models ?? []

  return (
    <div className="flex flex-wrap items-center gap-2 text-control">
      <select className="rounded-lg border border-outline bg-surface px-2 py-1.5" aria-label="Fornecedor" value={choice.provider} disabled={running || choose.isPending} onChange={(event) => choose.mutate({ provider: event.target.value === "claude" ? "claude" : "codex" })}>
        {(["codex", "claude"] as const).map((provider) => {
          const status = statuses.data?.find((known) => known.provider === provider)

          return <option key={provider} value={provider}>{providerNames[provider]}{status ? ` (${statusLabel(status)})` : ""}</option>
        })}
      </select>
      <select className="rounded-lg border border-outline bg-surface px-2 py-1.5" aria-label="Modelo" value={choice.model ?? ""} disabled={running || choose.isPending} onChange={(event) => choose.mutate({ provider: choice.provider, ...(event.target.value ? { model: event.target.value } : {}) })}>
        <option value="">Modelo padrão</option>
        {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
      </select>
      <button className="rounded-lg px-2 py-1.5 text-muted hover:bg-surface-hover hover:text-primary disabled:opacity-40" type="button" disabled={statuses.isFetching} onClick={() => void statuses.refetch()}>
        {statuses.isFetching ? "Verificando login…" : "Verificar login"}
      </button>
    </div>
  )
}

function Messages({ client }: { client: EngineClient }) {
  const messages = useInfiniteQuery(chatQueries.messages(client))
  const pages = messages.data?.pages.toReversed() ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
      <div className="flex flex-col gap-4 py-2">
        {messages.hasNextPage && (
          <button className="self-center rounded-lg px-3 py-1.5 text-control text-muted hover:bg-surface-hover hover:text-primary disabled:opacity-40" type="button" disabled={messages.isFetchingNextPage} onClick={() => void messages.fetchNextPage()}>
            {messages.isFetchingNextPage ? "Carregando…" : "Mostrar anteriores"}
          </button>
        )}
        {pages.flatMap((page) => page.messages).map((message) => <Message key={message.id} message={message} />)}
        <LiveReply />
      </div>
    </div>
  )
}

/** The streaming reply and the last turn's error, apart from the history so a delta rerenders only this. */
function LiveReply() {
  const reply = useStore(chatStore, (state) => state.reply)
  const error = useStore(chatStore, (state) => state.error)

  return (
    <>
      {reply !== undefined && <p className="whitespace-pre-wrap text-body text-primary">{reply || <span className="text-muted">Pensando…</span>}</p>}
      {error && <p className="text-support text-status-error" role="alert">{error}</p>}
    </>
  )
}

function Message({ message }: { message: ConversationMessage }) {
  if (message.role === "user") {
    return <p className="max-w-[80%] self-end whitespace-pre-wrap rounded-2xl bg-surface-raised px-4 py-2 text-body">{message.text}</p>
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="whitespace-pre-wrap text-body text-primary">{message.text}</p>
      <span className="text-metadata text-muted">{providerNames[message.provider]}</span>
    </div>
  )
}

function Composer({ client }: { client: EngineClient }) {
  const [text, setText] = useState("")
  const running = useStore(chatStore, (state) => state.reply !== undefined)
  const send = useMutation({ mutationFn: (input: { text: string }) => client.conversation.send(input), onSuccess: () => setText("") })
  const interrupt = useMutation({ mutationFn: () => client.conversation.interrupt() })

  function submit(event?: FormEvent) {
    event?.preventDefault()

    if (running || send.isPending || !text.trim()) {
      return
    }

    send.mutate({ text })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      submit(event)
    }
  }

  return (
    <form className="flex flex-col gap-1" onSubmit={submit}>
      {send.error && <p className="px-2 text-support text-status-error" role="alert">Não foi possível enviar: {send.error.message}</p>}
      <div className="flex items-end gap-2 rounded-2xl border border-outline bg-surface p-2">
        <textarea className="max-h-48 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-body outline-none placeholder:text-muted" rows={1} placeholder="Escreva para o Kolega" aria-label="Mensagem" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={handleKeyDown} />
        {running
        ? <button className="rounded-xl border border-outline-strong px-4 py-2 text-control text-status-error hover:bg-surface-hover disabled:opacity-40" type="button" disabled={interrupt.isPending} onClick={() => interrupt.mutate()}>Parar</button>
        : <button className="rounded-xl bg-accent px-4 py-2 text-control font-medium text-accent-ink hover:bg-primary disabled:opacity-40" type="submit" disabled={send.isPending || !text.trim()}>Enviar</button>}
      </div>
    </form>
  )
}
