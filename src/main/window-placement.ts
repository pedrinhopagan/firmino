import { execFile } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { type BrowserWindow, screen } from "electron"

const run = promisify(execFile)
const margin = 12

export const compactSize = { width: 400, height: 640 }
export const wideSize = { width: 1200, height: compactSize.height }

function kwinScript(resourceClass: string) {
  return `const resourceClass = ${JSON.stringify(resourceClass)}
const margin = ${margin}

function place(window, output) {
  const area = workspace.clientArea(KWin.MaximizeArea, output, workspace.currentDesktop)
  const current = window.frameGeometry
  const width = Math.min(current.width, area.width - 2 * margin)
  const height = Math.min(current.height, area.height - 2 * margin)
  const x = area.x + area.width - width - margin
  const y = area.y + area.height - height - margin

  if (current.x !== x || current.y !== y || current.width !== width || current.height !== height) {
    window.frameGeometry = { x, y, width, height }
  }
}

function anchor(window) {
  if (window.resourceClass !== resourceClass || !window.normalWindow) {
    return
  }

  place(window, workspace.screenAt(workspace.cursorPos))
  workspace.activeWindow = window
  window.frameGeometryChanged.connect((old) => {
    if (!window.resize && (old.width !== window.frameGeometry.width || old.height !== window.frameGeometry.height)) {
      place(window, window.output)
    }
  })
}

workspace.windowList().forEach(anchor)
workspace.windowAdded.connect(anchor)
`
}

function kwinCall(method: string, ...args: string[]) {
  return run("dbus-send", ["--session", "--print-reply", "--dest=org.kde.KWin", "/Scripting", `org.kde.kwin.Scripting.${method}`, ...args])
}

export class WindowPlacement {
  private kwinPlugin?: string

  async start(options: { resourceClass: string; directory: string }) {
    if (process.platform !== "linux" || !process.env.XDG_CURRENT_DESKTOP?.includes("KDE")) {
      return
    }

    const plugin = `${options.resourceClass}-placement`
    const file = join(options.directory, "kwin-placement.js")
    await writeFile(file, kwinScript(options.resourceClass))
    await kwinCall("unloadScript", `string:${plugin}`)
    const { stdout } = await kwinCall("loadScript", `string:${file}`, `string:${plugin}`)
    const id = /int32 (-?\d+)/.exec(stdout)?.[1]

    if (!id || id === "-1") {
      throw new Error(`KWin did not load the placement script: ${stdout.trim()}`)
    }

    // KWin reuses script ids after an unload, so `/Scripting/Script<id>.run` can start another script; `start()` runs every loaded one, and the script anchors a window that already exists.
    await kwinCall("start")
    this.kwinPlugin = plugin
  }

  async stop() {
    if (this.kwinPlugin) {
      await kwinCall("unloadScript", `string:${this.kwinPlugin}`)
    }
  }

  place(window: BrowserWindow) {
    const [width = compactSize.width, height = compactSize.height] = window.getSize()
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    window.setBounds({ x: area.x + area.width - width - margin, y: area.y + area.height - height - margin, width, height })
  }

  resize(window: BrowserWindow, size: { width: number; height: number }) {
    const bounds = window.getBounds()

    if (bounds.width === size.width && bounds.height === size.height) {
      return
    }

    window.setBounds({ x: bounds.x + bounds.width - size.width, y: bounds.y + bounds.height - size.height, ...size })
  }
}
