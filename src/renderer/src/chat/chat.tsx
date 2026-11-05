import { BoltIcon, ClockIcon } from "@heroicons/react/16/solid"
import { ArrowPathIcon } from "@heroicons/react/24/outline"
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import { type FormEvent, type KeyboardEvent, startTransition, useState } from "react"
import type { ConversationMessage } from "@src/shared/conversation"
import type { EngineClient } from "../engine-client"
import { Button } from "../ui/button"
import { IconButton } from "../ui/icon-button"
import { ChatContent } from "./chat-content"
import { ModelPicker, providerNames } from "./chat-model-picker"
import { chatQueries } from "./chat-queries"
import { chatStore } from "./chat-store"

const columnClassName = "mx-auto w-full max-w-[848px] px-4"
const pulsingDotDelays = ["", "[animation-delay:150ms]", "[animation-delay:300ms]"]

export function Chat({ client }: { client: EngineClient }) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col pb-3">
      <Messages client={client} />
      <div className={columnClassName}>
        <Composer client={client} />
      </div>
    </div>
  )
}

/** Messages mounted when the list opens; older cached ones mount `revealStep` at a time as the reader nears the top. */
const initialMessageLimit = 12
const revealStep = 30
const revealDistance = 600

function Messages({ client }: { client: EngineClient }) {
  const messages = useInfiniteQuery(chatQueries.messages(client))
  const [shown, setShown] = useState(initialMessageLimit)
  const cached = messages.data?.pages.toReversed().flatMap((page) => page.messages) ?? []
  const hidden = Math.max(0, cached.length - shown)
  const empty = messages.isSuccess && cached.length === 0

  /** The list is column-reversed, so `scrollTop` counts up from the end and the top sits at `clientHeight - scrollHeight`. */
  function revealNearTop(viewport: HTMLElement) {
    if (hidden === 0 || viewport.scrollHeight - viewport.clientHeight + viewport.scrollTop > revealDistance) {
      return
    }

    startTransition(() => setShown((count) => count + revealStep))
  }

  /** Checks again after every render, so a short list that cannot scroll still fills up with cached messages. */
  function observeContent(content: HTMLDivElement | null) {
    const viewport = content?.parentElement

    if (!content || !viewport) {
      return
    }

    const observer = new ResizeObserver(() => revealNearTop(viewport))
    observer.observe(content)

    return () => observer.disconnect()
  }

  async function showEarlier() {
    await messages.fetchNextPage()
    setShown((count) => count + revealStep)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto" onScroll={(event) => revealNearTop(event.currentTarget)}>
      <div ref={observeContent} className={`${columnClassName} flex grow flex-col justify-end gap-5 pt-4 pb-5`}>
        {hidden === 0 && messages.hasNextPage && (
          <Button className="self-center" variant="text" disabled={messages.isFetchingNextPage} onClick={() => void showEarlier()}>
            {messages.isFetchingNextPage ? "Carregando…" : "Mostrar anteriores"}
          </Button>
        )}
        {empty && <p className="my-auto max-w-64 self-center text-center text-support text-secondary">Peça algo ao Kolega. As Rotinas e os Gatilhos também respondem aqui.</p>}
        {cached.slice(hidden).map((message) => <Message key={message.id} message={message} />)}
        <LiveReply />
      </div>
    </div>
  )
}

function PulsingDots() {
  return pulsingDotDelays.map((delay) => <span key={delay} className={`size-1.5 animate-pulse rounded-full bg-muted [animation-duration:900ms] motion-reduce:animate-none ${delay}`} aria-hidden="true" />)
}

/** The streaming reply, the tool in use and the last turn's error, apart from the history so a delta rerenders only this. */
function LiveReply() {
  const reply = useStore(chatStore, (state) => state.reply)
  const tool = useStore(chatStore, (state) => state.tool)
  const error = useStore(chatStore, (state) => state.error)

  return (
    <>
      {reply && <ChatContent content={reply} />}
      {reply !== undefined && (!reply || tool) && (
        <div className="flex h-5 w-fit items-center gap-2" role="status" aria-label={tool ? `Usando ${tool}` : "O Kolega está respondendo"}>
          <PulsingDots />
          {tool && <span className="text-support text-secondary">Usando {tool}</span>}
        </div>
      )}
      {error && <p className="m-0 text-support text-status-error" role="alert">{error}</p>}
    </>
  )
}

const userBubbleClassName = "m-0 max-w-[min(640px,84%)] self-end rounded-[16px_16px_4px_16px] px-4 py-3 text-body whitespace-pre-wrap [overflow-wrap:anywhere]"

function Message({ message }: { message: ConversationMessage }) {
  if (message.routine || message.trigger) {
    const Icon = message.routine ? ClockIcon : BoltIcon

    return (
      <div className="flex max-w-[min(640px,84%)] flex-col items-end gap-1.5 self-end">
        <p className="m-0 flex items-center gap-1.5 text-metadata">
          <Icon className="size-3.5 text-muted" aria-hidden="true" />
          <span className="text-muted">{message.routine ? "Rotina" : "Gatilho"}</span>
          <span className="text-secondary">{message.routine ?? message.trigger}</span>
        </p>
        <p className={`${userBubbleClassName} max-w-full border border-outline text-secondary`}>{message.text}</p>
      </div>
    )
  }

  if (message.role === "user") {
    return <p className={`${userBubbleClassName} bg-surface-active text-primary`}>{message.text}</p>
  }

  return (
    <div className="group flex flex-col gap-1">
      <ChatContent content={message.text} />
      <span className="text-metadata text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100">{providerNames[message.provider]}</span>
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
    <form className="flex flex-col gap-2" onSubmit={submit}>
      {send.error && <p className="m-0 px-2 text-support text-status-error" role="alert">Não foi possível enviar: {send.error.message}</p>}
      <div className="flex flex-col gap-1 rounded-[18px] border border-outline-strong bg-surface-raised p-2 focus-within:border-muted">
        <textarea className="max-h-40 min-h-11 resize-none bg-transparent px-2 py-2 text-body text-primary outline-none [field-sizing:content] placeholder:text-muted" rows={1} placeholder="Escreva para o Kolega" aria-label="Mensagem" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={handleKeyDown} />
        <div className="flex items-center gap-2">
          <ProviderPicker client={client} />
          {running
            ? <Button variant="danger" disabled={interrupt.isPending} onClick={() => interrupt.mutate()}>Parar</Button>
            : <Button type="submit" disabled={send.isPending || !text.trim()}>Enviar</Button>}
        </div>
      </div>
    </form>
  )
}

/** The model that answers and a login check, in the prompt's bottom row; the picker stays disabled while a turn runs. */
function ProviderPicker({ client }: { client: EngineClient }) {
  const statuses = useQuery(chatQueries.providers(client))

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      <ModelPicker client={client} />
      <IconButton size={28} iconSize={14} label={statuses.isFetching ? "Verificando login…" : "Verificar login"} disabled={statuses.isFetching} onClick={() => void statuses.refetch()}>
        <ArrowPathIcon className={statuses.isFetching ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden="true" />
      </IconButton>
    </div>
  )
}
