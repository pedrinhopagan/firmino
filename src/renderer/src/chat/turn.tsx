import { CheckIcon, ClipboardDocumentIcon } from "@heroicons/react/16/solid"
import { useStore } from "@tanstack/react-store"
import { useState } from "react"
import type { ConversationMessage, WorkEntry } from "@src/shared/conversation"
import { ChatContent } from "./chat-content"
import { chatStore } from "./chat-store"
import { providerNames } from "./provider-picker"
import { elapsed, LiveWorkGroup, ThinkingRow, TurnHeader, WorkGroup, WorkingHeader } from "./work-log"

type Part = { type: "text"; text: string } | { type: "work"; entries: WorkEntry[] }

/** The answer's paragraphs with the steps between them, in the order they happened; steps with no text between them form one group. */
function parts(text: string, work: WorkEntry[]) {
  const result: Part[] = []
  let written = 0

  for (const entry of work) {
    const at = Math.min(entry.at, text.length)
    const before = text.slice(written, at)
    written = Math.max(written, at)

    if (before.trim()) {
      result.push({ type: "text", text: before })
    }

    const last = result.at(-1)

    if (last?.type === "work") {
      last.entries.push(entry)
    } else {
      result.push({ type: "work", entries: [entry] })
    }
  }

  const after = text.slice(written)

  if (after.trim()) {
    result.push({ type: "text", text: after })
  }

  return result
}

function TurnPart({ part }: { part: Part }) {
  if (part.type === "text") {
    return <ChatContent content={part.text} />
  }

  return <WorkGroup entries={part.entries} />
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button type="button" className="grid size-5 place-items-center rounded-sm text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" aria-label={copied ? "Copiado" : "Copiar resposta"} onClick={() => void copy()}>
      {copied ? <CheckIcon className="size-3.5" aria-hidden="true" /> : <ClipboardDocumentIcon className="size-3.5" aria-hidden="true" />}
    </button>
  )
}

/**
 * A finished answer, as T3 Code folds it: the work and the paragraphs before the last one stay behind "Trabalhou por 1m 05s".
 * `startedAt` is when the message it answers was sent.
 */
export function SettledTurn({ message, startedAt }: { message: ConversationMessage; startedAt?: string }) {
  const [open, setOpen] = useState(false)
  const all = parts(message.text, message.work ?? [])
  const last = all.at(-1)
  const final = last?.type === "text" ? last : undefined
  const folded = final ? all.slice(0, -1) : all
  const time = new Date(message.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })

  return (
    <div className="group flex min-w-0 flex-col gap-2">
      {folded.length > 0 && (
        <TurnHeader open={open} onToggle={() => setOpen(!open)}>
          {startedAt ? `Trabalhou por ${elapsed(startedAt, Date.parse(message.createdAt))}` : "Trabalhou"}
        </TurnHeader>
      )}
      {open && folded.map((part, index) => <TurnPart key={index} part={part} />)}
      {final && <ChatContent content={final.text} />}
      <div className="flex h-5 items-center gap-1.5 text-2xs text-muted-foreground opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        {message.text && <CopyButton text={message.text} />}
        <span>{providerNames[message.provider]}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={message.createdAt}>{time}</time>
      </div>
    </div>
  )
}

/** The turn in progress: how long it has run, its paragraphs and finished steps, and the step or the thinking happening now. */
export function LiveTurn() {
  const turn = useStore(chatStore, (state) => state.turn)
  const error = useStore(chatStore, (state) => state.error)

  if (!turn) {
    return error && <p className="m-0 text-xs text-destructive-foreground" role="alert">{error}</p>
  }

  const all = parts(turn.reply, turn.work)
  const last = all.at(-1)
  const done = last?.type === "work" ? all.slice(0, -1) : all

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <WorkingHeader startedAt={turn.startedAt} />
      {done.map((part, index) => <TurnPart key={index} part={part} />)}
      {last?.type === "work" ? <LiveWorkGroup entries={last.entries} /> : <ThinkingRow />}
    </div>
  )
}
