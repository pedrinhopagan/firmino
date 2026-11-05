import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React from "react"
import ReactDOM from "react-dom/client"
import { App } from "./app"
import { subscribeChatEvents } from "./chat/chat-events"
import { createEngineClient } from "./engine-client"
import "./styles.css"

const root = document.getElementById("root")

if (!root) {
  throw new Error("Renderer root is missing")
}

const client = createEngineClient(await window.desktop.getEngineConnection())
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } })
subscribeChatEvents({ client, queryClient })

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App client={client} />
    </QueryClientProvider>
  </React.StrictMode>,
)
