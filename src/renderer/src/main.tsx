import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React from "react"
import ReactDOM from "react-dom/client"
import { App } from "./app"
import { subscribeAppointmentEvents } from "./appointments/appointment-events"
import { AppointmentToast } from "./appointments/appointment-toast"
import { subscribeBrowserEvents } from "./browser/browser-events"
import { subscribeChatEvents } from "./chat/chat-events"
import { subscribeGoogleEvents } from "./connections/google-events"
import { subscribeWhatsappEvents } from "./connections/whatsapp-events"
import { createEngineClient } from "./engine-client"
import { openAppointment } from "./settings/menu-navigation"
import { startTheme } from "./theme/theme"
import "./styles.css"

const root = document.getElementById("root")

if (!root) {
  throw new Error("Renderer root is missing")
}

/** Main opens the Compromissos' alert window on the same page, with this hash. */
const toast = location.hash === "#toast"

// Before any await: Main can ask for a Compromisso as soon as a new window loads.
if (!toast) {
  window.desktop.onOpenAppointment(openAppointment)
}

startTheme()

const client = createEngineClient(await window.desktop.getEngineConnection())
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } })
subscribeAppointmentEvents(client)

if (!toast) {
  subscribeChatEvents({ client, queryClient })
  subscribeBrowserEvents()
  subscribeWhatsappEvents(client)
  subscribeGoogleEvents(client)
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {toast ? <AppointmentToast client={client} /> : <App client={client} />}
    </QueryClientProvider>
  </React.StrictMode>,
)
