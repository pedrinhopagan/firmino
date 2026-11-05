import { Store } from "@tanstack/react-store"
import type { BrowserState } from "@src/shared/browser"

/** The agent's page as Main last reported it: null while no page is open. */
export const browserStore = new Store<{ page: BrowserState | null }>({ page: null })

/** Subscribes once to Main's page changes, then reads the current page in case one opened before the Renderer loaded. */
export function subscribeBrowserEvents() {
  window.desktop.onBrowserState((page) => browserStore.setState(() => ({ page })))
  void window.desktop.getBrowserState().then((page) => browserStore.setState(() => ({ page })))
}
