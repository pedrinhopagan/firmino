import { ArrowLeftIcon, GlobeAltIcon, LinkIcon, MinusIcon, XMarkIcon } from "@heroicons/react/24/outline"
import { useStore } from "@tanstack/react-store"
import { useState } from "react"
import kolegaMark from "@resources/icon.svg"
import { browserStore } from "./browser/browser-events"
import { BrowserPanel } from "./browser/browser-panel"
import { Chat } from "./chat/chat"
import { Connections } from "./connections/connections"
import type { EngineClient } from "./engine-client"
import { IconButton } from "./ui/icon-button"

export function App({ client }: { client: EngineClient }) {
  const [connections, setConnections] = useState(false)
  const page = useStore(browserStore, (state) => state.page)
  const shown = page?.control === "user"

  return (
    <main className="flex h-dvh w-full overflow-hidden rounded-shell border border-outline-strong bg-canvas font-sans text-primary">
      {shown && <BrowserPanel page={page} />}
      <div className={`flex min-h-0 flex-col bg-surface ${shown ? "w-[399px] shrink-0 border-l border-outline" : "min-w-0 flex-1"}`}>
        <header className="flex h-13 shrink-0 items-center gap-2 border-b border-outline pr-2 pl-3 [-webkit-app-region:drag]">
          {connections
            ? (
                <>
                  <IconButton className="[-webkit-app-region:no-drag]" label="Voltar à conversa" tooltipPlacement="bottom" onClick={() => setConnections(false)}>
                    <ArrowLeftIcon aria-hidden="true" />
                  </IconButton>
                  <h1 className="m-0 flex-1 text-section font-semibold">Conexões</h1>
                </>
              )
            : (
                <>
                  <img className="size-7 shrink-0" src={kolegaMark} alt="" />
                  <h1 className="m-0 flex-1 text-section font-semibold">Kolega</h1>
                  {page && !shown && (
                    <IconButton className="[-webkit-app-region:no-drag]" label="Ver a página do Kolega" tooltipPlacement="bottom" onClick={() => void window.desktop.showBrowser()}>
                      <GlobeAltIcon aria-hidden="true" />
                    </IconButton>
                  )}
                  <IconButton className="[-webkit-app-region:no-drag]" label="Conexões" tooltipPlacement="bottom" onClick={() => setConnections(true)}>
                    <LinkIcon aria-hidden="true" />
                  </IconButton>
                </>
              )}
          <span className="mx-1 h-4 w-px bg-outline" aria-hidden="true" />
          <IconButton className="[-webkit-app-region:no-drag]" label="Minimizar janela" tooltipPlacement="bottom" onClick={() => window.desktop.minimizeWindow()}>
            <MinusIcon aria-hidden="true" />
          </IconButton>
          <IconButton className="[-webkit-app-region:no-drag]" label="Fechar janela" tone="window-close" tooltipPlacement="bottom" onClick={() => window.desktop.closeWindow()}>
            <XMarkIcon aria-hidden="true" />
          </IconButton>
        </header>
        {connections ? <Connections client={client} /> : <Chat client={client} />}
      </div>
    </main>
  )
}
