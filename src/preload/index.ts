import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import type { BrowserState } from "@src/shared/browser"
import type { Desktop } from "@src/shared/desktop"

const desktop: Desktop = {
  getEngineConnection: () => ipcRenderer.invoke("engine:get-connection"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  getBrowserState: () => ipcRenderer.invoke("browser:state"),
  onBrowserState(listener) {
    const forward = (_event: IpcRendererEvent, state: BrowserState | null) => listener(state)
    ipcRenderer.on("browser:state", forward)

    return () => {
      ipcRenderer.off("browser:state", forward)
    }
  },
  showBrowser: () => ipcRenderer.invoke("browser:show"),
  returnBrowserControl: () => ipcRenderer.invoke("browser:return-control"),
  setBrowserBounds: (bounds) => ipcRenderer.invoke("browser:bounds", bounds),
}

contextBridge.exposeInMainWorld("desktop", desktop)
