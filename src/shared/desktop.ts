import type { BrowserBounds, BrowserState } from "./browser"
import type { EngineConnection } from "./engine-ipc"

/** What the preload exposes to the Renderer as `window.desktop`. */
export interface Desktop {
  getEngineConnection: () => Promise<EngineConnection>
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  getBrowserState: () => Promise<BrowserState | null>
  /** Calls the listener on every change of the agent's page; the returned function stops it. */
  onBrowserState: (listener: (state: BrowserState | null) => void) => () => void
  /** Shows the page and gives the user control; the agent's next action waits for it back. */
  showBrowser: () => Promise<void>
  returnBrowserControl: () => Promise<void>
  setBrowserBounds: (bounds: BrowserBounds) => Promise<void>
}
