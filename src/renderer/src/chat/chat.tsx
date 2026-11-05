import { BoltIcon, ClockIcon } from "@heroicons/react/16/solid"
import { useInfiniteQuery, useMutation } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import { type FormEvent, type KeyboardEvent, startTransition, useState } from "react"
import type { ConversationMessage } from "@src/shared/conversation"
import type { EngineClient } from "../engine-client"
import { Button } from "../ui/button"
import { ChatContent } from "./chat-content"
import { chatQueries } from "./chat-queries"
import { chatStore } from "./chat-store"
import { ProviderPicker, providerNames } from "./provider-picker"

const columnClassName = "mx-auto w-full max-w-184 px-3"
const actionClassName = "grid size-8 shrink-0 place-items-center rounded-md shadow-xs outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 disabled:shadow-none"
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
      <div ref={observeContent} className={`${columnClassName} flex grow flex-col justify-end gap-4 pt-4 pb-4`}>
        {hidden === 0 && messages.hasNextPage && (
          <Button className="self-center" variant="ghost" disabled={messages.isFetchingNextPage} onClick={() => void showEarlier()}>
            {messages.isFetchingNextPage ? "Carregando…" : "Mostrar anteriores"}
          </Button>
        )}
        {messages.error && <p className="my-auto max-w-64 self-center text-center text-xs text-destructive-foreground" role="alert">Não foi possível carregar a conversa: {messages.error.message}</p>}
        {empty && <p className="my-auto max-w-64 self-center text-center text-xs text-muted-foreground">Peça algo ao Kolega. As Rotinas e os Gatilhos também respondem aqui.</p>}
        {cached.slice(hidden).map((message) => <Message key={message.id} message={message} />)}
        <LiveReply />
      </div>
    </div>
  )
}

function PulsingDots() {
  return pulsingDotDelays.map((delay) => <span key={delay} className={`size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-duration:900ms] motion-reduce:animate-none ${delay}`} aria-hidden="true" />)
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
          {tool && <span className="text-xs text-muted-foreground">Usando {tool}</span>}
        </div>
      )}
      {error && <p className="m-0 text-xs text-destructive-foreground" role="alert">{error}</p>}
    </>
  )
}

const userBubbleClassName = "m-0 max-w-[80%] self-end rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"

function Message({ message }: { message: ConversationMessage }) {
  if (message.routine || message.trigger) {
    const Icon = message.routine ? ClockIcon : BoltIcon

    return (
      <div className="flex max-w-[80%] flex-col items-end gap-1 self-end">
        <p className="m-0 flex items-center gap-1 text-2xs text-muted-foreground">
          <Icon className="size-3" aria-hidden="true" />
          <span>{message.routine ? "Rotina" : "Gatilho"}</span>
          <span className="text-foreground">{message.routine ?? message.trigger}</span>
        </p>
        <p className={`${userBubbleClassName} max-w-full border text-muted-foreground`}>{message.text}</p>
      </div>
    )
  }

  if (message.role === "user") {
    return <p className={`${userBubbleClassName} bg-message text-message-foreground`}>{message.text}</p>
  }

  return (
    <div className="group flex flex-col gap-1">
      <ChatContent content={message.text} />
      <span className="text-2xs text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100">{providerNames[message.provider]}</span>
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
      {send.error && <p className="m-0 px-1 text-xs text-destructive-foreground" role="alert">Não foi possível enviar: {send.error.message}</p>}
      <div className="flex flex-col rounded-xl border bg-surface-raised shadow-composer transition-colors duration-150 focus-within:border-input">
        <textarea className="max-h-40 min-h-10 resize-none bg-transparent px-3 pt-3 pb-1 text-sm leading-relaxed text-foreground outline-none [field-sizing:content] placeholder:text-placeholder" rows={1} placeholder="Escreva para o Kolega" aria-label="Mensagem" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={handleKeyDown} />
        <div className="flex items-center gap-2 px-1.5 pb-1.5">
          <ProviderPicker client={client} />
          {running
            ? (
                <button type="button" className={`${actionClassName} bg-destructive/90 text-white hover:bg-destructive`} aria-label="Parar" disabled={interrupt.isPending} onClick={() => interrupt.mutate()}>
                  <svg className="size-3" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1.5" /></svg>
                </button>
              )
            : (
                <button type="submit" className={`${actionClassName} bg-primary text-primary-foreground hover:bg-primary-hover`} aria-label="Enviar" disabled={send.isPending || !text.trim()}>
                  <svg className="size-3.5" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              )}
        </div>
      </div>
    </form>
  )
}
