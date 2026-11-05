import type { EngineConnection } from "./engine-ipc"

/** What the preload exposes to the Renderer as `window.desktop`. */
export interface Desktop {
  getEngineConnection: () => Promise<EngineConnection>
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
}
