import { ArrowLeftIcon, Cog6ToothIcon, GlobeAltIcon, MinusIcon, XMarkIcon } from "@heroicons/react/16/solid"
import { useStore } from "@tanstack/react-store"
import { useState } from "react"
import kolegaMark from "@resources/icon.svg"
import { browserStore } from "./browser/browser-events"
import { BrowserPanel } from "./browser/browser-panel"
import { Chat } from "./chat/chat"
import type { EngineClient } from "./engine-client"
import { Settings } from "./settings/settings"
import { IconButton } from "./ui/icon-button"

export function App({ client }: { client: EngineClient }) {
  const [settings, setSettings] = useState(false)
  const page = useStore(browserStore, (state) => state.page)
  const shown = page?.control === "user"

  return (
    <main className="flex h-dvh w-full overflow-hidden rounded-shell border bg-background text-foreground">
      {shown && <BrowserPanel page={page} />}
      <div className={`flex min-h-0 flex-col ${shown ? "w-[399px] shrink-0 border-l" : "min-w-0 flex-1"}`}>
        <header className="flex h-12 shrink-0 items-center gap-1 border-b pr-2 pl-3 [-webkit-app-region:drag]">
          {settings
            ? (
                <>
                  <IconButton className="-ml-1 [-webkit-app-region:no-drag]" label="Voltar à conversa" tooltipPlacement="bottom" onClick={() => setSettings(false)}>
                    <ArrowLeftIcon aria-hidden="true" />
                  </IconButton>
                  <h1 className="m-0 flex-1 text-sm font-medium">Configurações</h1>
                </>
              )
            : (
                <>
                  <img className="mr-1 size-5 shrink-0" src={kolegaMark} alt="" />
                  <h1 className="m-0 flex-1 text-sm font-medium">Kolega</h1>
                  {page && !shown && (
                    <IconButton className="[-webkit-app-region:no-drag]" label="Ver a página do Kolega" tooltipPlacement="bottom" onClick={() => void window.desktop.showBrowser()}>
                      <GlobeAltIcon aria-hidden="true" />
                    </IconButton>
                  )}
                  <IconButton className="[-webkit-app-region:no-drag]" label="Configurações" tooltipPlacement="bottom" onClick={() => setSettings(true)}>
                    <Cog6ToothIcon aria-hidden="true" />
                  </IconButton>
                </>
              )}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <IconButton className="[-webkit-app-region:no-drag]" label="Minimizar janela" tooltipPlacement="bottom" onClick={() => window.desktop.minimizeWindow()}>
            <MinusIcon aria-hidden="true" />
          </IconButton>
          <IconButton className="[-webkit-app-region:no-drag]" label="Fechar janela" tone="window-close" tooltipPlacement="bottom" onClick={() => window.desktop.closeWindow()}>
            <XMarkIcon aria-hidden="true" />
          </IconButton>
        </header>
        {settings ? <Settings client={client} /> : <Chat client={client} />}
      </div>
    </main>
  )
}
