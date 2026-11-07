import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import type { BrowserState } from "@src/shared/browser"
import type { Desktop } from "@src/shared/desktop"

const desktop: Desktop = {
  getEngineConnection: () => ipcRenderer.invoke("engine:get-connection"),
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
  zenIdentities: () => ipcRenderer.invoke("browser:zen-identities"),
  resizeToast: (height) => ipcRenderer.invoke("toast:resize", height),
  closeToast: () => ipcRenderer.invoke("toast:close"),
  openAppointment: (id) => ipcRenderer.invoke("toast:open-appointment", id),
  onOpenAppointment(listener) {
    const forward = (_event: IpcRendererEvent, id: string) => listener(id)
    ipcRenderer.on("appointment:open", forward)

    return () => {
      ipcRenderer.off("appointment:open", forward)
    }
  },
}

contextBridge.exposeInMainWorld("desktop", desktop)
