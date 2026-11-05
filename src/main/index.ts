import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { app, BrowserWindow, ipcMain, Menu, Notification, shell, Tray } from "electron"
import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { ContractRouterClient } from "@orpc/contract"
import { resolveAppProfile } from "@src/shared/app-profile"
import type { engineContract } from "@src/shared/engine-contract"
import { Browser } from "./browser/browser"
import { EngineProcess } from "./engine-process"

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

function showWindow(window: BrowserWindow) {
  // Wayland ignores restore() and focus() on a minimized or covered window; unmapping and mapping it again brings it to the front.
  window.hide()
  window.show()
  window.focus()
}

async function openWindow() {
  if (mainWindow) {
    showWindow(mainWindow)

    return
  }

  await createWindow().catch((error: unknown) => {
    console.error(error)
  })
}

async function createWindow() {
  const window = new BrowserWindow({
    title: appProfile.name,
    width: 960,
    height: 760,
    frame: false,
    icon,
    show: false,
    backgroundColor: "#0b0b0b",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow = window
  browser.attach(window)
  window.once("ready-to-show", () => showWindow(window))
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

  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL)

    return
  }

  await window.loadFile(join(__dirname, "../renderer/index.html"))
}

function notify(notice: { title: string; body: string }) {
  if (mainWindow?.isFocused() || !Notification.isSupported()) {
    return
  }

  const notification = new Notification({ ...notice, icon })
  notifications.add(notification)
  notification.on("click", () => {
    notifications.delete(notification)
    void openWindow()
  })
  notification.on("close", () => notifications.delete(notification))
  notification.on("failed", (_event, error) => {
    notifications.delete(notification)
    console.error("Notification failed", error)
  })
  notification.show()
}

app.on("second-instance", () => void openWindow())
app.on("activate", () => void openWindow())

const icon = join(app.getAppPath(), "resources", appProfile.icon)
const browser = new Browser({
  reply: (reply) => void engine.send(reply),
  onHandoff: (reason) => notify({ title: "O Kolega precisa de você", body: reason }),
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

function senderWindow(event: Electron.IpcMainInvokeEvent) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("Untrusted window caller")
  }

  return mainWindow
}

ipcMain.handle("window:minimize", (event) => senderWindow(event).minimize())
ipcMain.handle("window:toggle-maximize", (event) => {
  const window = senderWindow(event)

  if (window.isMaximized()) {
    window.unmaximize()

    return
  }

  window.maximize()
})
ipcMain.handle("window:close", (event) => senderWindow(event).close())

void app.whenReady().then(async () => {
  const starting = engine.start(randomBytes(32).toString("hex"))

  ipcMain.handle("engine:get-connection", () => starting.then(() => engine.connection))

  const loading = createWindow()

  await starting
  await engine.event({ name: "main.started", attributes: { process: "main", status: "ready", version: app.getVersion() } })
  tray = new Tray(icon)
  tray.setToolTip(appProfile.name)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir o Kolega", click: () => void openWindow() },
    { type: "separator" },
    { label: "Sair", click: () => app.quit() },
  ]))
  tray.on("click", () => void openWindow())
  await loading
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
  void engine.event({ name: "main.stopped", attributes: { process: "main", status: "stopping" } }).then(() => engine.stop()).then(() => {
    engineStopped = true
    app.quit()
  })
})
app.on("window-all-closed", () => {})
