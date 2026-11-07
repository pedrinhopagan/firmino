import { GlobeAltIcon } from "@heroicons/react/16/solid"
import { useStore } from "@tanstack/react-store"
import { useEffect } from "react"
import kolegaMark from "@resources/icon.svg"
import { PinnedAppointments } from "./appointments/appointment-card"
import { browserStore } from "./browser/browser-events"
import { BrowserPanel } from "./browser/browser-panel"
import { Chat } from "./chat/chat"
import type { EngineClient } from "./engine-client"
import { SideMenu } from "./settings/side-menu"
import { IconButton } from "./ui/icon-button"

/** The window always opens on the conversation: every menu and confirmation closes when it hides. */
function closeDialogsWhenHidden() {
  if (!document.hidden) {
    return
  }

  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.close()
  }
}

export function App({ client }: { client: EngineClient }) {
  const browserPage = useStore(browserStore, (state) => state.page)
  const shown = browserPage?.control === "user"

  useEffect(() => {
    document.addEventListener("visibilitychange", closeDialogsWhenHidden)

    return () => document.removeEventListener("visibilitychange", closeDialogsWhenHidden)
  }, [])

  return (
    <main className="flex h-dvh w-full overflow-hidden rounded-shell border bg-background text-foreground">
      {shown && <BrowserPanel page={browserPage} />}
      <div className={`flex min-h-0 flex-col ${shown ? "w-[399px] shrink-0 border-l" : "min-w-0 flex-1"}`}>
        <header className="flex h-12 shrink-0 items-center gap-1 border-b pr-2 pl-3 [-webkit-app-region:drag]">
          <img className="mr-1 size-5 shrink-0" src={kolegaMark} alt="" />
          <h1 className="m-0 flex-1 text-sm font-medium">Kolega</h1>
          {browserPage && !shown && (
            <IconButton className="[-webkit-app-region:no-drag]" label="Ver a página do Kolega" tooltipPlacement="bottom" onClick={() => void window.desktop.showBrowser()}>
              <GlobeAltIcon aria-hidden="true" />
            </IconButton>
          )}
          <SideMenu client={client} />
        </header>
        <PinnedAppointments client={client} />
        <Chat client={client} />
      </div>
    </main>
  )
}
