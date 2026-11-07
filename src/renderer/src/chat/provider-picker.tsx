import { ArrowPathIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, MagnifyingGlassIcon, StarIcon as SolidStarIcon } from "@heroicons/react/16/solid"
import { StarIcon } from "@heroicons/react/24/outline"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import { type KeyboardEvent, type ReactNode, type ToggleEvent, useEffect, useId, useRef, useState } from "react"
import type { FavoriteModel, ProviderChoice, ProviderId, ProviderModel, ProviderStatus } from "@src/shared/conversation"
import type { EngineClient } from "../engine-client"
import { IconButton } from "../ui/icon-button"
import { moveMenuFocus } from "../ui/menu-focus"
import { Tooltip, useTooltip } from "../ui/tooltip"
import { chatQueries } from "./chat-queries"
import { chatStore } from "./chat-store"
import { EffortOptions, effortLabel } from "./effort-options"

export const providerNames: Record<ProviderId, string> = { codex: "Codex", claude: "Claude" }

/** The OpenAI and Claude marks, as T3 Code draws them. */
export function ProviderIcon({ provider, className }: { provider: ProviderId; className: string }) {
  if (provider === "claude") {
    return (
      <svg className={`fill-[#d97757] ${className}`} viewBox="0 0 256 257" aria-hidden="true">
        <path d="m50.228 170.321 50.357-28.257.843-2.463-.843-1.361h-2.462l-8.426-.518-28.775-.778-24.952-1.037-24.175-1.296-6.092-1.297L0 125.796l.583-3.759 5.12-3.434 7.324.648 16.202 1.101 24.304 1.685 17.629 1.037 26.118 2.722h4.148l.583-1.685-1.426-1.037-1.101-1.037-25.147-17.045-27.22-18.017-14.258-10.37-7.713-5.25-3.888-4.925-1.685-10.758 7-7.713 9.397.649 2.398.648 9.527 7.323 20.35 15.75L94.817 91.9l3.889 3.24 1.555-1.102.195-.777-1.75-2.917-14.453-26.118-15.425-26.572-6.87-11.018-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0 82.05 1.426l4.472 3.888 6.61 15.101 10.694 23.786 16.591 32.34 4.861 9.592 2.592 8.879.973 2.722h1.685v-1.556l1.36-18.211 2.528-22.36 2.463-28.776.843-8.1 4.018-9.722 7.971-5.25 6.222 2.981 5.12 7.324-.713 4.73-3.046 19.768-5.962 30.98-3.889 20.739h2.268l2.593-2.593 10.499-13.934 17.628-22.036 7.778-8.749 9.073-9.657 5.833-4.601h11.018l8.1 12.055-3.628 12.443-11.342 14.388-9.398 12.184-13.48 18.147-8.426 14.518.778 1.166 2.01-.194 30.46-6.481 16.462-2.982 19.637-3.37 8.88 4.148.971 4.213-3.5 8.62-20.998 5.184-24.628 4.926-36.682 8.685-.454.324.519.648 16.526 1.555 7.065.389h17.304l32.21 2.398 8.426 5.574 5.055 6.805-.843 5.184-12.962 6.611-17.498-4.148-40.83-9.721-14-3.5h-1.944v1.167l11.666 11.406 21.387 19.314 26.767 24.887 1.36 6.157-3.434 4.86-3.63-.518-23.526-17.693-9.073-7.972-20.545-17.304h-1.36v1.814l4.73 6.935 25.017 37.59 1.296 11.536-1.814 3.76-6.481 2.268-7.13-1.297-14.647-20.544-15.1-23.138-12.185-20.739-1.49.843-7.194 77.448-3.37 3.953-7.778 2.981-6.48-4.925-3.436-7.972 3.435-15.749 4.148-20.544 3.37-16.333 3.046-20.285 1.815-6.74-.13-.454-1.49.194-15.295 20.999-23.267 31.433-18.406 19.702-4.407 1.75-7.648-3.954.713-7.064 4.277-6.286 25.47-32.405 15.36-20.092 9.917-11.6-.065-1.686h-.583L44.07 198.125l-12.055 1.555-5.185-4.86.648-7.972 2.463-2.593 20.35-13.999-.064.065Z" />
      </svg>
    )
  }

  return (
    <svg className={`fill-current ${className}`} viewBox="100 100 411 411" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M252.794 108.802C289.191 99.0484 326.265 110.305 351.148 135.135C385.113 126.072 422.85 134.862 449.492 161.505C476.136 188.149 484.925 225.888 475.862 259.85V259.854C500.696 284.735 511.95 321.81 502.198 358.207C492.447 394.602 464.161 421.084 430.215 430.217C421.083 464.162 394.603 492.448 358.206 502.199C321.812 511.951 284.734 500.693 259.852 475.864C225.887 484.927 188.15 476.137 161.507 449.495C134.864 422.851 126.073 385.111 135.136 351.149C110.304 326.266 99.0496 289.192 108.801 252.795C118.552 216.4 146.84 189.918 180.784 180.785C189.917 146.841 216.396 118.553 252.794 108.802ZM374.292 407.145C374.292 411.271 372.092 415.086 368.517 417.148L283.723 466.102C302.487 480.585 327.555 486.459 352.217 479.852C386.997 470.532 410.068 439.312 410.555 405.006V317.717C410.555 315.08 409.125 312.621 406.843 311.303L374.292 292.509V407.145ZM251.868 415.897C248.296 417.959 243.893 417.959 240.317 415.897L155.526 366.942C152.366 390.436 159.811 415.08 177.866 433.136H177.863C203.325 458.594 241.896 462.962 271.85 446.232L347.449 402.586C349.735 401.268 351.148 398.8 351.148 396.163V358.579L251.868 415.897ZM368.602 220.628C366.319 219.309 363.474 219.318 361.191 220.637L328.641 239.431L427.921 296.749C431.496 298.811 433.697 302.627 433.697 306.752V404.661C455.622 395.654 473.244 376.881 479.851 352.218C489.169 317.442 473.668 281.85 444.201 264.274L368.602 220.628ZM177.303 206.34C155.377 215.348 137.756 234.122 131.148 258.783C121.832 293.561 137.331 329.153 166.799 346.727L242.398 390.373C244.68 391.692 247.525 391.684 249.807 390.366L282.357 371.572L183.078 314.253C179.504 312.189 177.303 308.375 177.303 304.251V206.34ZM259.849 279.145V331.858L305.5 358.213L351.15 331.858V279.145L305.5 252.789L259.849 279.145ZM327.276 144.9C308.512 130.418 283.445 124.543 258.782 131.15C224.002 140.471 200.931 171.691 200.445 205.995V293.286C200.445 295.923 201.875 298.381 204.158 299.7L236.707 318.493V203.856C236.707 199.731 238.909 195.916 242.483 193.853L327.276 144.9ZM433.137 177.867C407.675 152.407 369.103 148.038 339.149 164.769L263.55 208.415C261.265 209.734 259.852 212.202 259.852 214.838V252.423L359.132 195.105C362.703 193.041 367.108 193.041 370.682 195.105L455.473 244.06C458.635 220.567 451.189 195.922 433.135 177.867H433.137Z" />
    </svg>
  )
}

export function statusLabel(status: ProviderStatus) {
  if (!status.account.enabled) {
    return "Desativada"
  }

  if (!status.installed) {
    return "Não instalado"
  }

  if (!status.loggedIn) {
    return "Sem login"
  }

  return [status.email ?? "Conectado", status.plan].filter(Boolean).join(" · ")
}

/** One compact control opens the model list and its reasoning levels side by side. */
export function ProviderPicker({ client }: { client: EngineClient }) {
  const queryClient = useQueryClient()
  const { data: statuses } = useQuery(chatQueries.providers(client))
  const { data: choice } = useQuery(chatQueries.active(client))
  const running = useStore(chatStore, (state) => state.turn !== undefined)
  const id = useId()
  const anchorName = `--provider-picker-${id.replace(/[^a-zA-Z0-9-]/g, "")}`
  const { mutate: choose, isPending, error } = useMutation({
    mutationFn: (choice: ProviderChoice) => client.providers.choose(choice),
    onSuccess: (choice) => queryClient.setQueryData(chatQueries.active(client).queryKey, choice),
  })

  if (!choice) {
    return <div className="flex-1" />
  }

  const chosen = statuses?.find((known) => known.account.id === choice.account)
  const chosenModel = chosen?.models.find((model) => (choice.model ? model.id === choice.model : model.isDefault))
  const disabled = running || isPending
  const modelLabel = chosenModel?.label ?? choice.model
  const effort = choice.effort ?? chosenModel?.defaultEffort

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <button
        type="button"
        className="inline-flex h-7 min-w-0 shrink items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64 [&:has(+:popover-open)]:bg-accent [&:has(+:popover-open)]:text-foreground"
        style={{ anchorName }}
        popoverTarget={id}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-label={`Modelo: ${chosen?.account.name ?? "conta"}, ${modelLabel ?? "padrão"}${effort ? ` · Esforço: ${effortLabel(effort)}` : ""}`}
      >
        {chosen && <ProviderIcon provider={chosen.account.provider} className="size-4 shrink-0" />}
        <span className="truncate">{modelLabel ?? chosen?.account.name}</span>
        {!!chosenModel?.efforts.length && effort && <>
          <span className="mx-0.5 h-3 w-px shrink-0 bg-border" aria-hidden="true" />
          <span className="shrink-0 text-xs">{effortLabel(effort)}</span>
        </>}
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
      </button>
      <ProviderMenu client={client} id={id} anchorName={anchorName} choice={choice} disabled={disabled} onPick={choose} />
      {error && <span className="truncate text-2xs text-destructive-foreground" role="alert">{error.message}</span>}
    </div>
  )
}

/** The list keeps the height of the longest tab, up to the menu's 86.5 spacing units, and scrolls past it. */
const listChromeRem = 3
const rowRem = 1.75
const maxListRem = 21.625

/** An account id, or "favorites"; account ids carry their provider, so none is "favorites". */
type Tab = string

interface ModelRow extends FavoriteModel, Pick<ProviderModel, "label" | "legacy"> {
  provider: ProviderId
  favorite: boolean
}

/** One button of the rail; the tooltip names the account, since two accounts of a provider share its mark. */
function RailButton({ label, pressed, onPick, children }: { label: string; pressed: boolean; onPick: () => void; children: ReactNode }) {
  const tooltip = useTooltip()

  return (
    <>
      <button
        type="button"
        {...tooltip.anchorProps}
        className="grid aspect-square w-full shrink-0 place-items-center rounded-md outline-none transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/10 aria-pressed:bg-background aria-pressed:shadow-xs"
        aria-pressed={pressed}
        aria-label={label}
        onClick={onPick}
      >
        {children}
      </button>
      <Tooltip {...tooltip.popoverProps} placement="right">{label}</Tooltip>
    </>
  )
}

const isReady = (status: ProviderStatus) => status.installed && status.loggedIn

/** Every model of the enabled accounts that are signed in, each marked when starred. */
function modelRows(statuses: ProviderStatus[], starred: FavoriteModel[]) {
  return statuses.filter(isReady).flatMap(({ account, models }) => models.map((model): ModelRow => ({
    account: account.id,
    provider: account.provider,
    model: model.id,
    label: model.label,
    legacy: model.legacy,
    favorite: starred.some((favorite) => favorite.account === account.id && favorite.model === model.id),
  })))
}

/** A search looks across every account; otherwise Favoritos shows the starred models in starring order, and an account tab puts its favorites first. */
function visibleRows(rows: ModelRow[], starred: FavoriteModel[], tab: Tab, search: string, accountNames: Map<string, string>) {
  const term = search.trim().toLowerCase()

  if (term) {
    return rows.filter((row) => `${row.label} ${row.model} ${accountNames.get(row.account) ?? ""}`.toLowerCase().includes(term))
  }

  if (tab === "favorites") {
    return starred.flatMap((favorite) => rows.filter((row) => row.account === favorite.account && row.model === favorite.model))
  }

  return rows.filter((row) => row.account === tab).toSorted((a, b) => Number(b.favorite) - Number(a.favorite))
}

/** Splits an account tab into the rows it lists and the older ones it folds; Favoritos and a search fold nothing. */
function foldOlder(visible: ModelRow[], folded: (row: ModelRow) => boolean, crossAccount: boolean) {
  if (crossAccount) {
    return { listed: visible, older: [] }
  }

  return { listed: visible.filter((row) => !folded(row)), older: visible.filter(folded) }
}

/** The rows an account tab shows before its older models open: the folded ones count as their one toggle. */
function tabLength(rows: ModelRow[], folded: (row: ModelRow) => boolean) {
  const hidden = rows.filter(folded).length

  return rows.length - hidden + Math.min(hidden, 1)
}

function emptyLabel(statuses: ProviderStatus[] | undefined, tab: Tab, search: string) {
  const status = statuses?.find((known) => known.account.id === tab)

  if (!statuses) {
    return "Carregando modelos…"
  }

  if (search.trim()) {
    return "Nenhum modelo encontrado."
  }

  if (tab === "favorites") {
    return "Nenhum favorito ainda."
  }

  if (status && !isReady(status)) {
    return `${status.account.name}: ${statusLabel(status)}.`
  }

  return "Nenhum modelo encontrado."
}

function ModelOption({ row, accountName, showAccount, checked, starOnHover, disabled, onPick, onToggleFavorite }: {
  row: ModelRow
  accountName: string
  showAccount: boolean
  checked: boolean
  starOnHover: boolean
  disabled: boolean
  onPick: () => void
  onToggleFavorite: () => void
}) {
  const starHidden = !row.favorite || starOnHover

  return (
    <div className={`group flex h-7 items-center gap-0.5 rounded-sm pr-1 hover:bg-accent has-focus-visible:bg-accent ${checked ? "bg-accent" : ""}`}>
      <button type="button" role="menuitemradio" aria-checked={checked} className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-xs font-medium text-foreground outline-none disabled:pointer-events-none disabled:opacity-64" disabled={disabled} onClick={onPick}>
        {showAccount && <ProviderIcon provider={row.provider} className="size-3.5 shrink-0" />}
        <span className="min-w-0 truncate">{row.label}<span className="sr-only">, {accountName}</span></span>
      </button>
      <button type="button" className={`grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring ${starHidden ? "opacity-0 group-hover:opacity-100" : ""}`} aria-pressed={row.favorite} aria-label={`${row.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}: ${row.label}, ${accountName}`} onClick={onToggleFavorite}>
        <StarIcon className={`size-3 ${row.favorite ? "fill-current text-amber-400" : ""}`} aria-hidden="true" />
      </button>
      <CheckIcon className={`size-3 shrink-0 ${checked ? "" : "invisible"}`} aria-hidden="true" />
    </div>
  )
}

/** Favoritos and the accounts on the left; a search and the models of the tab in view on the right. Each time the menu opens it shows Favoritos when there are any, else the chosen account. */
function ProviderMenu({ client, id, anchorName, choice, disabled, onPick }: { client: EngineClient; id: string; anchorName: string; choice: ProviderChoice; disabled: boolean; onPick: (choice: ProviderChoice) => void }) {
  const queryClient = useQueryClient()
  const statuses = useQuery(chatQueries.providers(client))
  const favorites = useQuery(chatQueries.favorites(client))
  const [tab, setTab] = useState<Tab>(choice.account)
  const [search, setSearch] = useState("")
  const [showOlder, setShowOlder] = useState(false)
  const searching = search.trim() !== ""
  /** Favoritos and a search list models of every account, each marked with its provider. */
  const crossAccount = tab === "favorites" || searching
  const popover = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const restoreFocus = useRef<"model" | "trigger" | undefined>(undefined)
  const toggleFavorite = useMutation({
    mutationFn: (favorite: FavoriteModel) => client.providers.toggleFavorite(favorite),
    onSuccess: (saved) => queryClient.setQueryData(chatQueries.favorites(client).queryKey, saved),
  })
  const enabled = statuses.data?.filter((known) => known.account.enabled) ?? []
  const starred = favorites.data ?? []
  const accountNames = new Map(enabled.map(({ account }) => [account.id, account.name]))
  const rows = modelRows(enabled, starred)
  const visible = visibleRows(rows, starred, tab, search, accountNames)
  const selectedModel = choice.model ?? enabled.find((known) => known.account.id === choice.account)?.models.find((model) => model.isDefault)?.id
  const chosenModel = enabled.find((known) => known.account.id === choice.account)?.models.find((model) => model.id === selectedModel)
  const effort = choice.effort ?? chosenModel?.defaultEffort
  const isChosen = (row: ModelRow) => row.account === choice.account && row.model === selectedModel
  /** A favorite or the chosen model stays in view even when a newer one replaced it. */
  const folded = (row: ModelRow) => row.legacy && !row.favorite && !isChosen(row)
  const { listed, older } = foldOlder(visible, folded, crossAccount)
  const longestTab = Math.max(1, starred.length, chosenModel?.efforts.length ?? 0, ...enabled.map(({ account }) => tabLength(rows.filter((row) => row.account === account.id), folded)))

  useEffect(() => {
    if (disabled || !restoreFocus.current) {
      return
    }

    const target = restoreFocus.current
    restoreFocus.current = undefined

    if (target === "trigger") {
      document.querySelector<HTMLButtonElement>(`button[popovertarget="${id}"]`)?.focus()

      return
    }

    popover.current?.querySelector<HTMLButtonElement>("[aria-label=Modelos] [aria-checked=true]")?.focus()
  }, [disabled, choice, id])

  const option = (row: ModelRow) => (
    <ModelOption
      key={`${row.account}:${row.model}`}
      row={row}
      accountName={accountNames.get(row.account) ?? row.account}
      showAccount={crossAccount}
      checked={isChosen(row)}
      starOnHover={tab === "favorites" && !searching}
      disabled={disabled}
      onPick={() => pick(row)}
      onToggleFavorite={() => toggleFavorite.mutate({ account: row.account, model: row.model })}
    />
  )

  function pick(row: ModelRow) {
    if (isChosen(row)) {
      return
    }

    restoreFocus.current = "model"
    onPick({ account: row.account, model: row.model })
  }

  function pickEffort(next: string) {
    if (!chosenModel) {
      return
    }

    restoreFocus.current = "trigger"
    popover.current?.hidePopover()
    onPick({ ...choice, model: chosenModel.id, effort: next })
  }

  function showTab(next: Tab) {
    setTab(next)
    setShowOlder(false)
  }

  // The tooltips inside are popovers too, and React lets their toggle events bubble up to here.
  function handleToggle(event: ToggleEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.newState !== "open") {
      return
    }

    setSearch("")
    setShowOlder(false)
    setTab(starred.length > 0 ? "favorites" : choice.account)
    searchRef.current?.focus()
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const first = listed.at(0)

    if (event.key !== "Enter" || event.nativeEvent.isComposing || !first || disabled) {
      return
    }

    event.preventDefault()
    pick(first)
  }

  return (
    <div
      ref={popover}
      id={id}
      popover="auto"
      role="dialog"
      aria-label="Modelo e esforço"
      className="inset-auto m-0 mb-1 overflow-hidden rounded-lg border bg-popover p-0 text-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] [position-area:top_span-right] [position-try-fallbacks:flip-inline]"
      style={{ positionAnchor: anchorName }}
      onToggle={handleToggle}
    >
      <div className="flex max-h-86.5 w-92 max-w-[calc(100vw-2rem)]" style={{ minHeight: `min(calc(${listChromeRem + longestTab * rowRem}rem + 1px), ${maxListRem}rem)` }}>
        <div className="flex w-9 shrink-0 flex-col gap-1 overflow-y-auto bg-muted/30 p-1" role="group" aria-label="Conta">
          <RailButton label="Favoritos" pressed={tab === "favorites"} onPick={() => showTab("favorites")}>
            <SolidStarIcon className="size-5" aria-hidden="true" />
          </RailButton>
          <div className="shrink-0 border-b border-border/70" aria-hidden="true" />
          {enabled.map((status) => (
            <RailButton key={status.account.id} label={`${status.account.name} · ${statusLabel(status)}`} pressed={tab === status.account.id} onPick={() => showTab(status.account.id)}>
              <ProviderIcon provider={status.account.provider} className={`size-5 ${isReady(status) ? "" : "opacity-50"}`} />
            </RailButton>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col border-l border-border/70 bg-muted/40" onKeyDown={moveMenuFocus}>
          <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border/70 pr-1 pl-2">
            <MagnifyingGlassIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input ref={searchRef} className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-placeholder [&::-webkit-search-cancel-button]:hidden" type="search" autoComplete="off" placeholder="Buscar modelos…" aria-label="Buscar modelos" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={handleSearchKeyDown} />
            <IconButton label={statuses.isFetching ? "Verificando login…" : "Verificar login"} disabled={statuses.isFetching} onClick={() => void statuses.refetch()}>
              <ArrowPathIcon className={statuses.isFetching ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden="true" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1" role="menu" aria-label="Modelos">
            {visible.length === 0 && <p className="m-0 px-2 py-3 text-xs text-muted-foreground">{emptyLabel(statuses.data, tab, search)}</p>}
            {listed.map(option)}
            {older.length > 0 && (
              <button type="button" role="menuitem" className="flex h-7 w-full items-center gap-1.5 rounded-sm px-2 text-left text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent" aria-expanded={showOlder} onClick={() => setShowOlder(!showOlder)}>
                <ChevronRightIcon className={`size-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${showOlder ? "rotate-90" : ""}`} aria-hidden="true" />
                Modelos antigos ({older.length})
              </button>
            )}
            {showOlder && older.map(option)}
          </div>
        </div>
        {!!chosenModel?.efforts.length && <EffortOptions model={chosenModel} effort={effort} disabled={disabled} onPick={pickEffort} />}
      </div>
    </div>
  )
}
