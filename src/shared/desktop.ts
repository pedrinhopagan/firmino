import type { BrowserBounds, BrowserState, ZenIdentity } from "./browser"
import type { EngineConnection } from "./engine-ipc"

/** What the preload exposes to the Renderer as `window.desktop`. */
export interface Desktop {
  getEngineConnection: () => Promise<EngineConnection>
  getBrowserState: () => Promise<BrowserState | null>
  /** Calls the listener on every change of the agent's page; the returned function stops it. */
  onBrowserState: (listener: (state: BrowserState | null) => void) => () => void
  /** Shows the page and gives the user control; the agent's next action waits for it back. */
  showBrowser: () => Promise<void>
  returnBrowserControl: () => Promise<void>
  setBrowserBounds: (bounds: BrowserBounds) => Promise<void>
  /** The Zen accounts on this computer, read from a copy of the profile. */
  zenIdentities: () => Promise<ZenIdentity[]>
  /** In the Compromissos' alert window: fits it to its cards, and shows it the first time. */
  resizeToast: (height: number) => Promise<void>
  /** In the Compromissos' alert window: closes it once no card is left. */
  closeToast: () => Promise<void>
  /** In the Compromissos' alert window: shows the main window on this Compromisso. */
  openAppointment: (id: string) => Promise<void>
  /** In the main window: calls the listener with the Compromisso an alert asked to open; the returned function stops it. */
  onOpenAppointment: (listener: (id: string) => void) => () => void
}
