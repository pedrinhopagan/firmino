import { contextBridge, ipcRenderer } from "electron"
import type { Desktop } from "@src/shared/desktop"

const desktop: Desktop = {
  getEngineConnection: () => ipcRenderer.invoke("engine:get-connection"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
}

contextBridge.exposeInMainWorld("desktop", desktop)
