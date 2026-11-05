import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { app, BrowserWindow, ipcMain } from "electron"
import { resolveAppProfile } from "@src/shared/app-profile"
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

function showMainWindow() {
  if (!mainWindow) {
    return
  }

  // Wayland ignores restore() and focus() on a minimized or covered window; unmapping and mapping it again brings it to the front.
  mainWindow.hide()
  mainWindow.show()
  mainWindow.focus()
}

app.on("second-instance", showMainWindow)
app.on("activate", showMainWindow)

const icon = join(app.getAppPath(), "resources", appProfile.icon)
const engineName = process.platform === "win32" ? "kolega-engine.exe" : "kolega-engine"
const engine = new EngineProcess({
  executable: app.isPackaged ? join(process.resourcesPath, "engine", engineName) : join(app.getAppPath(), "dist-engine", engineName),
  dataDirectory: app.getPath("userData"),
  appVersion: app.getVersion(),
  development: !app.isPackaged,
  onUnexpectedExit(error) {
    console.error(error)
    app.exit(1)
  },
})

void app.whenReady().then(async () => {
  const starting = engine.start(randomBytes(32).toString("hex"))

  ipcMain.handle("engine:get-connection", () => starting.then(() => engine.connection))

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
  window.once("ready-to-show", showMainWindow)
  window.on("page-title-updated", (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", (event) => event.preventDefault())
  ipcMain.handle("window:minimize", () => window.minimize())
  ipcMain.handle("window:toggle-maximize", () => window.isMaximized() ? window.unmaximize() : window.maximize())
  ipcMain.handle("window:close", () => window.close())

  const loading = process.env.ELECTRON_RENDERER_URL && !app.isPackaged
    ? window.loadURL(process.env.ELECTRON_RENDERER_URL)
    : window.loadFile(join(__dirname, "../renderer/index.html"))

  await starting
  await engine.event({ name: "main.started", attributes: { process: "main", status: "ready", version: app.getVersion() } })
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
  void engine.event({ name: "main.stopped", attributes: { process: "main", status: "stopping" } }).then(() => engine.stop()).then(() => {
    engineStopped = true
    app.quit()
  })
})
app.on("window-all-closed", () => app.quit())
