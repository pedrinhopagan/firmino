import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { app, BrowserWindow, ipcMain, Menu, Notification, shell, Tray } from "electron"
import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { ContractRouterClient } from "@orpc/contract"
import { resolveAppProfile } from "@src/shared/app-profile"
import type { engineContract } from "@src/shared/engine-contract"
import { AppointmentToast } from "./appointment-toast"
import { Browser } from "./browser/browser"
import { EngineProcess } from "./engine-process"
import { compactSize, WindowPlacement, wideSize } from "./window-placement"

const appProfile = resolveAppProfile(app.isPackaged)

// One data folder per machine in dev, outside the checkout, so every worktree opens the same data.
if (process.env.KOLEGA_USER_DATA) {
  app.setPath("userData", process.env.KOLEGA_USER_DATA)
} else if (!app.isPackaged) {
  app.setPath("userData", join(app.getPath("appData"), "kolega-dev"))
}

app.setName(appProfile.name)

if (process.platform === "linux") {
  app.setDesktopName(`${appProfile.desktopName}.desktop`)
  app.commandLine.appendSwitch("class", appProfile.desktopName)
}

if (appProfile.debuggingPort) {
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1")
  app.commandLine.appendSwitch("remote-debugging-port", String(appProfile.debuggingPort))
}

if (!app.requestSingleInstanceLock()) {
  app.exit(0)
}

let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
const notifications = new Set<Notification>()
const placement = new WindowPlacement()
const toastTitle = `${appProfile.name}: compromisso`
const placing = app.whenReady().then(() => placement.start({ resourceClass: appProfile.desktopName, toastCaption: toastTitle, directory: app.getPath("userData") })).catch((error: unknown) => {
  console.warn("KWin placement not loaded; the compositor places the window.", error instanceof Error ? error.message : error)
})
let creating: Promise<void> | undefined
let shownAt = 0
let hiddenAt = 0
const activationGraceMs = 500

function showWindow(window: BrowserWindow) {
  // Wayland ignores restore() and focus() on a minimized or covered window; unmapping and mapping it again brings it to the front.
  window.hide()
  window.show()
  placement.place(window)
  window.focus()
  shownAt = Date.now()
}

function toggleWindow() {
  if (mainWindow?.isVisible() && (mainWindow.isFocused() || Date.now() - shownAt < activationGraceMs)) {
    mainWindow.hide()

    return
  }

  // A tray click that took the focus already hid the window; it meant to close it, not to open it again.
  if (Date.now() - hiddenAt < activationGraceMs) {
    return
  }

  reopenWindow()
}

async function openWindow() {
  if (creating) {
    return creating
  }

  if (mainWindow) {
    showWindow(mainWindow)

    return
  }

  creating = createWindow().finally(() => {
    creating = undefined
  })
  await creating
}

/** Opens the window from an event that cannot wait on it; startup awaits openWindow itself so a failed load still stops the app. */
function reopenWindow() {
  openWindow().catch((error: unknown) => {
    console.error(error)
  })
}

async function createWindow() {
  await placing
  const window = new BrowserWindow({
    title: appProfile.name,
    ...(browser.shown ? wideSize : compactSize),
    frame: false,
    transparent: true,
    icon,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow = window
  browser.attach(window)
  window.once("ready-to-show", () => showWindow(window))
  // A click outside hides the window, as Alt+K does. Bringing it to the front blurs it too, and so does an alert opening, so a blur right after either is skipped.
  window.on("blur", () => {
    if (Date.now() - shownAt < activationGraceMs || toast.openedWithin(activationGraceMs)) {
      return
    }

    window.hide()
    hiddenAt = Date.now()
  })
  window.once("closed", () => {
    mainWindow = undefined
  })
  window.on("page-title-updated", (event) => event.preventDefault())
  // A link in a reply asks for a new window; it opens in the system browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) {
      shell.openExternal(url).catch((error: unknown) => {
        console.error(error)
      })
    }

    return { action: "deny" }
  })
  window.webContents.on("will-navigate", (event) => event.preventDefault())
  await loadRenderer(window)
}

/** Loads the Renderer; a hash picks another root than the conversation. */
async function loadRenderer(window: BrowserWindow, hash = "") {
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) {
    await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)

    return
  }

  await window.loadFile(join(__dirname, "../renderer/index.html"), { hash })
}

function notify(notice: { title: string; body: string }) {
  if (mainWindow?.isFocused() || !Notification.isSupported()) {
    return
  }

  const notification = new Notification({ ...notice, icon })
  notifications.add(notification)
  notification.on("click", () => {
    notifications.delete(notification)
    reopenWindow()
  })
  notification.on("close", () => notifications.delete(notification))
  notification.on("failed", (_event, error) => {
    notifications.delete(notification)
    console.error("Notification failed", error)
  })
  notification.show()
}

app.on("second-instance", () => reopenWindow())
app.on("activate", () => reopenWindow())
process.on("SIGUSR2", () => {
  if (app.isReady()) {
    toggleWindow()
  }
})

const icon = join(app.getAppPath(), "resources", appProfile.icon)
const toast = new AppointmentToast({
  title: toastTitle,
  icon,
  placement,
  async load(window, hash) {
    await placing
    await loadRenderer(window, hash)
  },
  onOpenAppointment(id) {
    openWindow().then(() => mainWindow?.webContents.send("appointment:open", id)).catch((error: unknown) => {
      console.error(error)
    })
  },
})
const browser = new Browser({
  reply: (reply) => void engine.send(reply),
  onHandoff: (reason) => notify({ title: "O Kolega precisa de você", body: reason }),
  onShownChange(shown) {
    if (mainWindow) {
      placement.resize(mainWindow, shown ? wideSize : compactSize)
    }
  },
  zenIdentity: async () => (await engineClient().zen.identity()).identity,
})
const engineName = process.platform === "win32" ? "kolega-engine.exe" : "kolega-engine"
const engine = new EngineProcess({
  executable: app.isPackaged ? join(process.resourcesPath, "engine", engineName) : join(app.getAppPath(), "dist-engine", engineName),
  dataDirectory: app.getPath("userData"),
  appVersion: app.getVersion(),
  development: !app.isPackaged,
  ...(import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID ? { googleClient: { id: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID, ...(import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET ? { secret: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET } : {}) } } : {}),
  onOpenConsent(url) {
    shell.openExternal(url).catch((error: unknown) => {
      console.error(error)
    })
  },
  onBrowserRequest(request) {
    void browser.execute(request)
  },
  onBrowserCancel(id) {
    browser.cancel(id)
  },
  onTurnNotice: notify,
  onAppointmentAlert: () => toast.open(),
  onUnexpectedExit(error) {
    console.error(error)
    app.exit(1)
  },
})

let client: ContractRouterClient<typeof engineContract> | undefined

/** Main's own client of the Engine router, for the state the Engine owns and Main needs. */
function engineClient() {
  const { url, token } = engine.connection
  client ??= createORPCClient(new RPCLink({ url, headers: { authorization: `Bearer ${token}` } }))

  return client
}

void app.whenReady().then(async () => {
  const starting = engine.start(randomBytes(32).toString("hex"))

  ipcMain.handle("engine:get-connection", () => starting.then(() => engine.connection))

  // Both are awaited together so a window that fails to load stops the app even before the Engine is ready.
  await Promise.all([process.argv.includes("--hidden") ? undefined : openWindow(), starting.then(async () => {
    await engine.event({ name: "main.started", attributes: { process: "main", status: "ready", version: app.getVersion() } })
    tray = new Tray(icon)
    tray.setToolTip(appProfile.name)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Abrir o Kolega", click: () => reopenWindow() },
      { type: "separator" },
      { label: "Sair", click: () => app.quit() },
    ]))
    tray.on("click", toggleWindow)
  })])
}).catch(async (error: unknown) => {
  console.error(error)
  await engine.stop()
  app.exit(1)
})

let engineStopped = false

app.on("before-quit", (event) => {
  if (engineStopped) {
    return
  }

  event.preventDefault()
  tray?.destroy()
  browser.close()
  void placement.stop().catch((error: unknown) => console.warn("KWin placement not unloaded.", error)).then(() => engine.event({ name: "main.stopped", attributes: { process: "main", status: "stopping" } })).then(() => engine.stop()).then(() => {
    engineStopped = true
    app.quit()
  })
})
app.on("window-all-closed", () => {})
