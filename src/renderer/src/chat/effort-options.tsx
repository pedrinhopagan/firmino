import { CheckIcon } from "@heroicons/react/16/solid"
import type { ProviderModel } from "@src/shared/conversation"
import { moveMenuFocus } from "../ui/menu-focus"

const effortLabels: Record<string, string> = {
  none: "Nenhum",
  minimal: "Mínimo",
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  xhigh: "Muito alto",
  max: "Máximo",
  ultra: "Ultra",
}

export function effortLabel(effort: string) {
  return effortLabels[effort] ?? effort
}

export function EffortOptions({ model, effort, disabled, onPick }: {
  model: Pick<ProviderModel, "label" | "efforts" | "defaultEffort">
  effort?: string
  disabled: boolean
  onPick: (effort: string) => void
}) {
  return (
    <div className="flex min-h-0 w-32 shrink-0 flex-col border-l border-border/70 bg-muted/40">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/70 px-2 text-2xs text-muted-foreground">
        <span>Esforço</span>
        <span className="ml-auto min-w-0 truncate" title={model.label}>{model.label}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1" role="menu" aria-label="Esforço" onKeyDown={moveMenuFocus}>
        {model.efforts.map((value) => (
          <button
            key={value}
            type="button"
            role="menuitemradio"
            aria-checked={value === effort}
            disabled={disabled}
            className="flex h-7 w-full items-center gap-1 rounded-sm px-2 text-left text-xs font-medium outline-none transition-colors duration-150 hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-64"
            onClick={() => onPick(value)}
          >
            <span className="min-w-0 flex-1 whitespace-nowrap">{effortLabel(value)}</span>
            {value === model.defaultEffort && <span className="text-[9px] font-normal text-muted-foreground">Padrão</span>}
            <CheckIcon className={`size-3 shrink-0 ${value === effort ? "" : "invisible"}`} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  )
}
