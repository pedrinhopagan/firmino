import { ChatBubbleLeftEllipsisIcon, CheckIcon, ChevronDownIcon, XMarkIcon } from "@heroicons/react/16/solid"
import { useMutation } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import { useEffect, useRef, useState } from "react"
import type { QuestionAnswers, WorkEntry } from "@src/shared/conversation"
import type { EngineClient } from "../engine-client"
import { chatStore } from "./chat-store"

type QuestionEntry = Extract<WorkEntry, { kind: "question" }>

/** T3 Code waits this long after a single choice, so the user sees the check before the next question. */
const advanceDelayMs = 200

/** The questions the agent is waiting on, if any. */
export function useOpenQuestion() {
  return useStore(chatStore, (state) => state.turn?.work.find((entry): entry is QuestionEntry => entry.kind === "question" && entry.status === "running"))
}

interface Draft {
  /** The question set these answers belong to. */
  id: string
  index: number
  answers: QuestionAnswers
  /** The options picked on the current question. */
  picked: string[]
}

/** Walks the user through the agent's questions one at a time, and sends every answer after the last one. */
export function useQuestion(entry: QuestionEntry | undefined, client: EngineClient) {
  const [stored, setDraft] = useState<Draft>()
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const respond = useMutation({ mutationFn: (input: { id: string; answers?: QuestionAnswers }) => client.conversation.answer(input) })
  const draft = entry && (stored?.id === entry.id ? stored : { id: entry.id, index: 0, answers: {}, picked: [] })
  const question = draft && entry.questions[draft.index]

  useEffect(() => () => clearTimeout(advanceTimer.current), [])

  function answer(chosen: string[]) {
    if (!entry || !draft || !question || chosen.length === 0 || respond.isPending) {
      return false
    }

    const answers = { ...draft.answers, [question.id]: chosen }

    if (draft.index + 1 < entry.questions.length) {
      setDraft({ id: entry.id, index: draft.index + 1, answers, picked: [] })

      return true
    }

    respond.mutate({ id: entry.id, answers })

    return true
  }

  /** A single choice moves on a moment later, as T3 Code does; a multiple choice toggles the option. */
  function pick(label: string) {
    if (!draft || !question) {
      return
    }

    if (question.multiSelect) {
      setDraft({ ...draft, picked: draft.picked.includes(label) ? draft.picked.filter((picked) => picked !== label) : [...draft.picked, label] })

      return
    }

    setDraft({ ...draft, picked: [label] })
    clearTimeout(advanceTimer.current)
    advanceTimer.current = setTimeout(() => answer([label]), advanceDelayMs)
  }

  return {
    entry,
    question,
    index: draft?.index ?? 0,
    picked: draft?.picked ?? [],
    busy: respond.isPending,
    error: respond.error,
    pick,
    /** Whether the composer's text or the picked options answer the current question. */
    ready: (text: string) => !!text.trim() || (draft?.picked.length ?? 0) > 0,
    /** Answers with the composer's text, which wins over the picked options as T3 Code's custom answer; false when nothing answers. */
    submit: (text: string) => answer(text.trim() ? [text.trim()] : draft?.picked ?? []),
    dismiss: () => entry && respond.mutate({ id: entry.id }),
  }
}

type Asking = ReturnType<typeof useQuestion>

/** Number keys pick options while the user is not typing, as in T3 Code; the composer counts as not typing while empty. */
function typing(target: EventTarget | null) {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    return target.value !== ""
  }

  return target instanceof HTMLElement && target.isContentEditable
}

/** The current question over the composer: its options, the progress through the questions, and a way to dismiss them. */
export function QuestionPanel({ asking }: { asking: Asking }) {
  const { entry, question, index, picked, busy, pick } = asking

  useEffect(() => {
    if (!question || busy) {
      return
    }

    function pickByNumber(event: KeyboardEvent) {
      const option = question?.options[Number(event.key) - 1]

      if (!option || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) {
        return
      }

      event.preventDefault()
      pick(option.label)
    }

    document.addEventListener("keydown", pickByNumber)

    return () => document.removeEventListener("keydown", pickByNumber)
  })

  if (!entry || !question) {
    return null
  }

  return (
    <details key={`${entry.id}:${index}`} open className="group/question border-b">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
        <ChatBubbleLeftEllipsisIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="shrink-0 font-medium text-muted-foreground">{question.header}</span>
        <span className="hidden min-w-0 flex-1 truncate text-foreground/85 group-[:not([open])]/question:block">{question.question}</span>
        <span className="ms-auto flex shrink-0 items-center gap-1.5 text-muted-foreground">
          {entry.questions.length > 1 && <span className="tabular-nums">{index + 1}/{entry.questions.length}</span>}
          <ChevronDownIcon className="size-3.5 transition-transform duration-150 group-[:not([open])]/question:-rotate-90" aria-hidden="true" />
          <button type="button" className="grid size-5 place-items-center rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-64" aria-label="Dispensar a pergunta sem responder" disabled={busy} onClick={(event) => {
            event.preventDefault()
            asking.dismiss()
          }}>
            <XMarkIcon className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      </summary>
      <div className="max-h-64 overflow-y-auto px-3 pb-2 [overflow-wrap:anywhere]">
        <p className="m-0 text-sm text-foreground/85">{question.question}</p>
        {question.multiSelect && <p className="m-0 mt-1 text-xs text-muted-foreground">Escolha uma ou mais opções.</p>}
        <div className="mt-2 flex flex-col gap-0.5">
          {question.options.map((option, position) => {
            const chosen = picked.includes(option.label)

            return (
              <button key={option.label} type="button" className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 ${chosen ? "bg-muted text-foreground" : "text-foreground/85 hover:bg-muted/50"}`} aria-pressed={chosen} disabled={busy} onClick={() => pick(option.label)}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{option.label}</span>
                  {option.description && option.description !== option.label && <span className="text-2xs text-muted-foreground">{option.description}</span>}
                </span>
                {chosen
                  ? <CheckIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  : position < 9 && <kbd className="grid size-5 shrink-0 place-items-center font-sans text-2xs text-muted-foreground tabular-nums">{position + 1}</kbd>}
              </button>
            )
          })}
        </div>
      </div>
    </details>
  )
}
