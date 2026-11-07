import { join } from "node:path"
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron"
import { z } from "zod"
import { parse } from "@src/shared/parse"
import { toastWidth, type WindowPlacement } from "./window-placement"

const toastHeight = z.number().int().min(1).max(2_000)
const appointmentId = z.string().min(1)

interface AppointmentToastOptions {
  /** The window's caption, which the KWin script tells apart from the main window. */
  title: string
  icon: string
  placement: WindowPlacement
  load: (window: BrowserWindow, hash: string) => Promise<void>
  /** Shows the main window on one Compromisso, after a click on its card. */
  onOpenAppointment: (id: string) => void
}

/**
 * The Compromissos' alert outside the app: a small window over every other, at the top right.
 * The Renderer fills it with the alerting cards, sizes it to them and closes it when none is left. It shows without taking the focus.
 */
export class AppointmentToast {
  private window?: BrowserWindow
  private shownAt = 0

  constructor(private readonly options: AppointmentToastOptions) {
    ipcMain.handle("toast:resize", (event, height: unknown) => {
      const window = this.sentBy(event)

      if (!window) {
        return
      }

      window.setSize(toastWidth, parse(toastHeight, height))

      if (!window.isVisible()) {
        window.showInactive()
        this.shownAt = Date.now()
        options.placement.placeToast(window)
      }
    })
    ipcMain.handle("toast:close", (event) => this.sentBy(event)?.close())
    ipcMain.handle("toast:open-appointment", (event, id: unknown) => {
      if (this.sentBy(event)) {
        options.onOpenAppointment(parse(appointmentId, id))
      }
    })
  }

  /** Opens the window, or lets the one already open show the new alert. */
  open() {
    if (this.window) {
      return
    }

    const window = new BrowserWindow({
      title: this.options.title,
      width: toastWidth,
      height: 1,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      icon: this.options.icon,
      show: false,
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    this.window = window
    window.once("closed", () => {
      this.window = undefined
    })
    window.on("page-title-updated", (event) => event.preventDefault())
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    window.webContents.on("will-navigate", (event) => event.preventDefault())
    this.options.load(window, "toast").catch((error: unknown) => {
      console.error("The Compromisso alert did not load", error)
      window.destroy()
    })
  }

  /** Whether the alert opened in the last `ms`: the focus it takes from the main window then is not the user leaving it. */
  openedWithin(ms: number) {
    return Date.now() - this.shownAt < ms
  }

  /** The toast window, when it sent this message; the main window shares the preload but must not move it. */
  private sentBy(event: IpcMainInvokeEvent) {
    if (event.sender !== this.window?.webContents) {
      return undefined
    }

    return this.window
  }
}
