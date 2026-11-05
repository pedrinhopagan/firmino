import { MinusIcon, Square2StackIcon, XMarkIcon } from "@heroicons/react/24/outline"
import type { EngineHealth } from "@src/shared/engine-contract"
import { IconButton } from "./ui/icon-button"

export function App({ health }: { health: EngineHealth | null }) {
  return (
    <main className="relative flex h-dvh w-full flex-col items-center justify-center gap-2 overflow-hidden bg-canvas font-sans text-primary">
      <WindowControls />
      <h1 className="text-title font-semibold">Kolega</h1>
      {health
        ? <p className="flex items-center gap-2 text-support text-muted" role="status"><span className="size-1.5 rounded-full bg-status-success" aria-hidden="true" />Engine pronto · {health.runtime}</p>
        : <p className="flex items-center gap-2 text-support text-status-error" role="alert"><span className="size-1.5 rounded-full bg-status-error" aria-hidden="true" />Não foi possível falar com o Engine.</p>}
    </main>
  )
}

function WindowControls() {
  return (
    <>
      <div className="absolute inset-x-0 top-0 z-20 h-3 [-webkit-app-region:drag]" aria-hidden="true" />
      <div className="absolute top-6 right-6 z-30 flex items-center gap-0.5 [-webkit-app-region:no-drag]">
        <IconButton className="opacity-35 hover:opacity-100 focus-visible:opacity-100" type="button" label="Minimizar janela" tooltipPlacement="bottom" onClick={() => window.desktop.minimizeWindow()}>
          <MinusIcon aria-hidden="true" />
        </IconButton>
        <IconButton className="opacity-35 hover:opacity-100 focus-visible:opacity-100" type="button" label="Maximizar ou restaurar janela" tooltipPlacement="bottom" onClick={() => window.desktop.toggleMaximizeWindow()}>
          <Square2StackIcon aria-hidden="true" />
        </IconButton>
        <IconButton className="opacity-35 hover:opacity-100 focus-visible:opacity-100" type="button" label="Fechar janela" tone="window-close" tooltipPlacement="bottom" onClick={() => window.desktop.closeWindow()}>
          <XMarkIcon aria-hidden="true" />
        </IconButton>
      </div>
    </>
  )
}
