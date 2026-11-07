import { ChatBubbleLeftEllipsisIcon, ChevronRightIcon, CommandLineIcon, EyeIcon, GlobeAltIcon, LightBulbIcon, MagnifyingGlassIcon, PencilSquareIcon, WrenchIcon, WrenchScrewdriverIcon, XMarkIcon } from "@heroicons/react/16/solid"
import { type ComponentType, type ReactNode, type SVGProps, useEffect, useRef, useState } from "react"
import type { WorkEntry } from "@src/shared/conversation"
import { ChatContent } from "./chat-content"
import { ChatImage } from "./chat-image"
import { toolLabels } from "./tool-labels"

type Step = Extract<WorkEntry, { title: string }>
type Kind = WorkEntry["kind"]

const kindIcons: Record<Kind, ComponentType<SVGProps<SVGSVGElement>>> = {
  thinking: LightBulbIcon,
  question: ChatBubbleLeftEllipsisIcon,
  command: CommandLineIcon,
  read: EyeIcon,
  edit: PencilSquareIcon,
  search: MagnifyingGlassIcon,
  web: GlobeAltIcon,
  tool: WrenchIcon,
}

const verbs: Record<Step["kind"], { running: string; done: string; missing: string }> = {
  command: { running: "Rodando", done: "Rodou", missing: "comando" },
  read: { running: "Lendo", done: "Leu", missing: "arquivo" },
  edit: { running: "Editando", done: "Editou", missing: "arquivo" },
  search: { running: "Buscando", done: "Buscou", missing: "arquivos" },
  web: { running: "Pesquisando", done: "Pesquisou", missing: "na web" },
  tool: { running: "Usando", done: "Usou", missing: "ferramenta" },
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

const tallies: Record<Exclude<Kind, "thinking">, (count: number) => string> = {
  command: (count) => `Rodou ${plural(count, "comando", "comandos")}`,
  read: (count) => `Leu ${plural(count, "arquivo", "arquivos")}`,
  edit: (count) => `Editou ${plural(count, "arquivo", "arquivos")}`,
  search: (count) => `Buscou ${plural(count, "vez", "vezes")}`,
  web: (count) => `Pesquisou na web ${plural(count, "vez", "vezes")}`,
  tool: (count) => `Usou ${plural(count, "ferramenta", "ferramentas")}`,
  question: (count) => `Fez ${plural(count, "pergunta", "perguntas")}`,
}

/** The summary names the two kinds that matter most, as T3 Code does; what changes things comes first. */
const summaryPriority: Record<Exclude<Kind, "thinking">, number> = { command: 0, edit: 0, question: 0, read: 1, search: 1, web: 1, tool: 2 }

/** Thinking arrives as Markdown; its row shows it as one plain line. */
function thought(text: string) {
  return text.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim()
}

function fileName(path: string) {
  return path.split("/").at(-1) ?? path
}

/** What a step acted on: the program a command runs, the file, the search or the tool. */
function subject(step: Step) {
  if (step.kind === "command") {
    // The first word that is not a variable assignment, as in `LANG=C sort`.
    return fileName(step.title.trim().split(/\s+/).find((word) => !word.includes("=")) ?? "")
  }

  if (step.kind !== "read" && step.kind !== "edit") {
    return step.title
  }

  const [first = "", ...others] = step.title.split("\n")

  if (others.length === 0) {
    return fileName(first)
  }

  return `${fileName(first)} +${others.length}`
}

/** A step's label: a list row names a command in full, while the live row names its program, as T3 Code does. */
function stepLabel(entry: WorkEntry, live: boolean) {
  if (entry.kind === "thinking") {
    return thought(entry.text) || (entry.status === "running" ? "Pensando" : "Pensou")
  }

  if (entry.kind === "question") {
    return entry.questions[0]?.question ?? "Pergunta"
  }

  if (entry.kind === "command" && !live && entry.title) {
    return entry.title
  }

  const tense = entry.status === "running" ? "running" : "done"
  const tool = entry.kind === "tool" ? toolLabels[entry.title] : undefined

  if (tool) {
    return tool[tense]
  }

  const verb = verbs[entry.kind]

  return `${verb[tense]} ${subject(entry) || verb.missing}`
}

/** "Rodou 2 comandos e leu 1 arquivo": at most two kinds by name, and how many other steps. */
function groupSummary(entries: WorkEntry[]) {
  const steps = entries.filter((entry) => entry.kind !== "thinking")

  if (entries.length === 1 && steps.length === 0) {
    return "Pensou"
  }

  if (steps.length === 0) {
    return `Pensou (×${entries.length})`
  }

  const kinds = [...new Set(steps.map((step) => step.kind))]
  const named = new Set(kinds.toSorted((a, b) => summaryPriority[a] - summaryPriority[b]).slice(0, 2))
  const labels = kinds.filter((kind) => named.has(kind)).map((kind) => {
    const ofKind = steps.filter((step) => step.kind === kind)
    // The same file edited twice is one edited file.
    const count = kind === "edit" ? new Set(ofKind.flatMap((step) => step.kind === "edit" ? step.title.split("\n") : [])).size : ofKind.length

    return tallies[kind](count)
  })
  const others = steps.filter((step) => !named.has(step.kind)).length

  if (others > 0) {
    labels.push(`mais ${plural(others, "ação", "ações")}`)
  }

  const [first, ...rest] = labels.map((label, index) => index === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1))
  const last = rest.pop()

  return [first, ...rest].join(", ") + (last ? ` e ${last}` : "")
}

function groupIcon(entries: WorkEntry[]) {
  const kinds = new Set(entries.filter((entry) => entry.kind !== "thinking").map((entry) => entry.kind))
  const [only] = kinds

  if (kinds.size === 0) {
    return kindIcons.thinking
  }

  if (kinds.size === 1 && only) {
    return kindIcons[only]
  }

  return WrenchScrewdriverIcon
}

/** 12s, 1m 05s, 1h 02m. */
export function elapsed(startedAt: string, endedAt: number) {
  const seconds = Math.max(0, Math.floor((endedAt - Date.parse(startedAt)) / 1000))
  const minutes = Math.floor(seconds / 60)

  if (minutes === 0) {
    return `${seconds}s`
  }

  if (minutes < 60) {
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
  }

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

/** Counts up every second by writing the text itself, so the turn does not render again each tick. */
function Timer({ startedAt }: { startedAt: string }) {
  const text = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const timer = setInterval(() => {
      if (text.current) {
        text.current.textContent = elapsed(startedAt, Date.now())
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [startedAt])

  return <span ref={text} className="tabular-nums">{elapsed(startedAt, Date.now())}</span>
}

const rowClassName = "flex min-h-6 w-full min-w-0 items-center gap-1.5 rounded-md px-0.5 text-left text-sm leading-relaxed text-muted-foreground outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-accent/50"

function Chevron({ open, hidden = false }: { open: boolean; hidden?: boolean }) {
  return <ChevronRightIcon className={`size-3 shrink-0 opacity-70 transition-transform duration-200 ${open ? "rotate-90" : ""} ${hidden ? "invisible" : ""}`} aria-hidden="true" />
}

function RowIcon({ icon: Icon, failed = false }: { icon: ComponentType<SVGProps<SVGSVGElement>>; failed?: boolean }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center">
      <Icon className={`size-4 ${failed ? "text-destructive-foreground/70" : "text-muted-foreground/80"}`} aria-hidden="true" />
    </span>
  )
}

/** The divider over a turn's work: "Trabalhando há 12s" while it runs, "Trabalhou por 1m 05s ›" once it ends. */
export function TurnHeader({ children, open, onToggle }: { children: ReactNode; open?: boolean; onToggle?: () => void }) {
  const className = "flex h-6 w-fit items-center gap-1 rounded-md px-1 text-sm text-muted-foreground tabular-nums"

  return (
    <div className="border-b pt-1 pb-2">
      {onToggle
        ? (
            <button type="button" className={`${className} outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring`} aria-expanded={open} onClick={onToggle}>
              {children}
              <Chevron open={!!open} />
            </button>
          )
        : <p className={`${className} m-0`} role="status">{children}</p>}
    </div>
  )
}

export function WorkingHeader({ startedAt }: { startedAt: string }) {
  return <TurnHeader>Trabalhando há <Timer startedAt={startedAt} /></TurnHeader>
}

function answerText(entry: Extract<WorkEntry, { kind: "question" }>, id: string) {
  return entry.answers?.[id]?.join(", ")
}

function WorkDetail({ entry }: { entry: WorkEntry }) {
  if (entry.kind === "thinking") {
    return <div className="ms-7 max-h-96 overflow-auto py-1"><ChatContent content={entry.text} /></div>
  }

  if (entry.kind === "question") {
    return (
      <dl className="ms-7 my-1 flex flex-col gap-2 text-sm">
        {entry.questions.map((question) => (
          <div key={question.id}>
            <dt className="text-muted-foreground">{question.question}</dt>
            <dd className="ms-3 text-foreground">{answerText(entry, question.id) ?? "Sem resposta"}</dd>
          </div>
        ))}
      </dl>
    )
  }

  const shown = [entry.kind === "command" && entry.title ? `$ ${entry.title}` : undefined, entry.detail].filter(Boolean).join("\n\n")

  return (
    <div className="ms-7 mt-1 flex flex-col gap-2">
      {entry.image && <ChatImage src={entry.image} alt={fileName(entry.image)} />}
      {shown && <pre className="m-0 max-h-64 overflow-auto rounded-md bg-muted/60 px-3 py-2 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere] select-text">{shown}</pre>}
    </div>
  )
}

function hasDetail(entry: WorkEntry) {
  if (entry.kind === "thinking") {
    return !!entry.text.trim()
  }

  if (entry.kind === "question") {
    return true
  }

  return !!entry.detail || !!entry.image || entry.kind === "command"
}

/** One step: a click reveals its thinking, its command and output, its image or the answers it got. */
function WorkRow({ entry }: { entry: WorkEntry }) {
  const [open, setOpen] = useState(false)
  const expandable = hasDetail(entry)
  const failed = entry.status === "failed" && entry.kind !== "thinking"
  const question = entry.kind === "question" ? entry.questions[0] : undefined
  const answer = entry.kind === "question" && entry.status !== "running" ? (question && answerText(entry, question.id)) ?? "Dispensada" : undefined

  return (
    <div className="min-w-0">
      <button type="button" className={rowClassName} disabled={!expandable} aria-expanded={expandable ? open : undefined} onClick={() => setOpen(!open)}>
        <RowIcon icon={kindIcons[entry.kind]} failed={failed} />
        <span className="flex min-w-0 flex-1 gap-1.5">
          <span className={`truncate ${answer ? "min-w-0" : "min-w-0 flex-1"}`}>{stepLabel(entry, false)}</span>
          {answer && <span className="min-w-0 truncate text-foreground">{answer}</span>}
        </span>
        {failed && <XMarkIcon className="size-3 shrink-0 text-destructive-foreground/70" aria-label="Falhou" />}
        <Chevron open={open} hidden={!expandable} />
      </button>
      {open && <WorkDetail entry={entry} />}
    </div>
  )
}

function WorkList({ entries }: { entries: WorkEntry[] }) {
  return (
    <div className="flex max-h-72 min-w-0 flex-col overflow-y-auto">
      {entries.map((entry) => <WorkRow key={entry.id} entry={entry} />)}
    </div>
  )
}

/** Steps between two paragraphs of the answer: one step as its own row, more behind a summary such as "Rodou 2 comandos". */
export function WorkGroup({ entries }: { entries: WorkEntry[] }) {
  const [open, setOpen] = useState(false)
  const [only] = entries

  if (entries.length === 1 && only) {
    return <WorkRow entry={only} />
  }

  const failed = entries.findLast((entry) => entry.kind !== "thinking")?.status === "failed"

  return (
    <div className="min-w-0">
      <button type="button" className={rowClassName} aria-expanded={open} onClick={() => setOpen(!open)}>
        <RowIcon icon={groupIcon(entries)} failed={failed} />
        <span className="min-w-0 flex-1 truncate">{groupSummary(entries)}</span>
        <Chevron open={open} />
      </button>
      {open && <WorkList entries={entries} />}
    </div>
  )
}

function LiveRow({ icon, label }: { icon: ComponentType<SVGProps<SVGSVGElement>>; label: string }) {
  return (
    <>
      <RowIcon icon={icon} />
      <span className="live-shine min-w-0 truncate">{label}</span>
    </>
  )
}

/** The latest step of the work in progress, shining while the turn runs; a click lists the steps since the last paragraph. */
export function LiveWorkGroup({ entries }: { entries: WorkEntry[] }) {
  const [open, setOpen] = useState(false)
  const latest = entries.findLast((entry) => entry.status === "running") ?? entries.at(-1)

  if (!latest) {
    return null
  }

  return (
    <div className="min-w-0" role="status">
      <button type="button" className={`${rowClassName} w-fit max-w-full`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <LiveRow icon={kindIcons[latest.kind]} label={stepLabel(latest, true)} />
      </button>
      {open && <WorkList entries={entries} />}
    </div>
  )
}

/** Shown while the agent works with no step in progress, as T3 Code's "Thinking". */
export function ThinkingRow() {
  return (
    <div className="flex min-h-6 w-fit items-center gap-1.5 px-0.5 text-sm leading-relaxed text-muted-foreground" role="status">
      <LiveRow icon={LightBulbIcon} label="Pensando" />
    </div>
  )
}
