import { ChatBubbleLeftRightIcon, LinkIcon, MinusIcon, Square2StackIcon, XMarkIcon } from "@heroicons/react/24/outline"
import { useState } from "react"
import { Chat } from "./chat/chat"
import { Connections } from "./connections/connections"
import type { EngineClient } from "./engine-client"
import { IconButton } from "./ui/icon-button"

export function App({ client }: { client: EngineClient }) {
  const [connections, setConnections] = useState(false)

  return (
    <main className="relative flex h-dvh w-full flex-col items-center overflow-hidden bg-canvas font-sans text-primary">
      <WindowControls />
      <div className="absolute top-6 left-6 z-30 [-webkit-app-region:no-drag]">
        <IconButton type="button" label={connections ? "Voltar à conversa" : "Conexões"} tooltipPlacement="bottom" onClick={() => setConnections(!connections)}>
          {connections ? <ChatBubbleLeftRightIcon aria-hidden="true" /> : <LinkIcon aria-hidden="true" />}
        </IconButton>
      </div>
      {connections ? <Connections client={client} /> : <Chat client={client} />}
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
