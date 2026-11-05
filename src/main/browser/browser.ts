import { type BrowserWindow, ipcMain, type Session, View, WebContentsView } from "electron"
import { type BrowserAction, browserBounds, type BrowserBounds, type BrowserReply, type BrowserRequest, type BrowserState } from "@src/shared/browser"
import { parse } from "@src/shared/parse"
import { BrowserDriver } from "./browser-driver"
import { importZenSession } from "./zen-session"

const webPreferences = { partition: "persist:kolega-browser", sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
const parked = { x: 1 - 1280, y: 1 - 800, width: 1280, height: 800 }
/** An idle page closes after this, freeing its renderer process; logins stay in the session, so reopening costs one load. */
const idleMs = 5 * 60_000
/** How long an action waits for the user to give control back before it answers that the user still has it. */
const handoffWaitMs = 10 * 60_000
const httpUrl = /^https?:\/\//

interface Page {
  view: WebContentsView
  /** Hides the one pixel of the parked view that stays inside the window. */
  cover: View
  driver: BrowserDriver
  control: BrowserState["control"]
  reason: string | null
}

function blockNonHttp(event: { preventDefault(): void }, url: string) {
  if (!httpUrl.test(url)) {
    event.preventDefault()
  }
}

/**
 * The one page the agent drives, owned by Main so it outlives the chat Renderer.
 * Nothing is created until the agent's first navigation; the user sees the view only during a handoff or when they ask for it.
 */
export class Browser {
  private page?: Page
  private bounds?: BrowserBounds
  private running?: { id: string; controller: AbortController; done: Promise<void> }
  private readonly waiters = new Set<() => void>()
  private idle?: ReturnType<typeof setTimeout>
  private preparingSession?: Promise<void>

  constructor(private readonly window: BrowserWindow, private readonly reply: (reply: BrowserReply) => void) {
    const handle = (name: string, action: (raw: unknown) => unknown) => {
      ipcMain.handle(`browser:${name}`, (event, raw: unknown) => {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
          throw new Error("Untrusted browser caller")
        }

        return action(raw)
      })
    }

    handle("state", () => this.state())
    handle("show", () => this.show())
    handle("return-control", () => this.returnControl())
    handle("bounds", (raw) => {
      this.bounds = parse(browserBounds, raw)
      this.place()
    })
  }

  /** Runs one action from the Engine and replies; a newer request ends the one still running. */
  async execute(request: BrowserRequest) {
    while (this.running) {
      this.running.controller.abort(new Error("A newer browser action replaced this one."))
      await this.running.done
    }

    const controller = new AbortController()
    const { promise: done, resolve: finish } = Promise.withResolvers<void>()
    this.running = { id: request.id, controller, done }
    clearTimeout(this.idle)

    try {
      this.reply({ type: "browser-reply", id: request.id, result: await this.run(request.input, controller.signal), error: false })
    } catch (error) {
      this.reply({ type: "browser-reply", id: request.id, result: error instanceof Error ? error.message : "The browser action failed.", error: true })
    } finally {
      this.running = undefined
      finish()
      this.scheduleIdle()
    }
  }

  cancel(id: string) {
    if (this.running?.id === id) {
      this.running.controller.abort(new Error("Browser action interrupted."))
    }
  }

  close() {
    const page = this.page

    if (!page) {
      return
    }

    this.page = undefined
    clearTimeout(this.idle)
    page.driver.close()

    if (!this.window.isDestroyed()) {
      this.window.contentView.removeChildView(page.view)
      this.window.contentView.removeChildView(page.cover)
    }

    void page.view.webContents.session.cookies.flushStore()
    page.view.webContents.close()
    this.release()
    this.publish()
  }

  private async run(input: BrowserAction, signal: AbortSignal) {
    if (input.action === "close") {
      if (!this.page) {
        return "The page is already closed."
      }

      this.close()

      return "Page closed. Site logins stay saved."
    }

    const page = input.action === "navigate" ? await this.open() : this.page

    if (!page) {
      throw new Error("No page is open. Navigate to a URL first.")
    }

    if (input.action === "handoff") {
      page.control = "user"
      page.reason = input.reason
      this.publish()
      await this.waitForControl(signal)

      return "The user gave control back. Take a fresh snapshot before continuing."
    }

    if (input.action === "take_control") {
      this.returnControl()
    }

    await this.waitForControl(signal)
    const result = await page.driver.execute(input, signal)
    signal.throwIfAborted()

    return result
  }

  /** Opens the page on first use, once the session is ready. */
  private async open() {
    if (this.page) {
      return this.page
    }

    const view = new WebContentsView({ webPreferences })
    const contents = view.webContents
    const page: Page = { view, cover: new View(), driver: new BrowserDriver(contents), control: "agent", reason: null }
    this.page = page
    view.setBorderRadius(12)
    page.cover.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    page.cover.setBackgroundColor("#0b0b0b")
    this.park(page)
    // One page at a time: a link that opens a new window loads in this page instead.
    contents.setWindowOpenHandler(({ url }) => {
      if (httpUrl.test(url)) {
        void contents.loadURL(url).catch(() => {})
      }

      return { action: "deny" }
    })
    contents.on("will-navigate", blockNonHttp)
    contents.on("will-redirect", blockNonHttp)
    contents.on("did-navigate", () => this.publish())
    contents.on("did-navigate-in-page", () => this.publish())
    contents.on("page-title-updated", () => this.publish())
    contents.on("render-process-gone", () => {
      if (this.page === page) {
        this.close()
      }
    })
    this.publish()
    this.preparingSession ??= this.prepareSession(contents.session)
    await this.preparingSession

    return page
  }

  /** Once per run: the session refuses permissions and downloads, then takes Zen's cookies, if any. */
  private async prepareSession(session: Session) {
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.setPermissionCheckHandler(() => false)
    session.on("will-download", (event) => event.preventDefault())
    await importZenSession(session.cookies).then(({ imported, skipped }) => {
      console.info(`Zen session: ${imported} cookies imported, ${skipped} skipped.`)
    }, (error: unknown) => {
      console.warn("Zen session not imported; the browser works without it.", error instanceof Error ? error.message : error)
    })
  }

  private show() {
    const page = this.page

    if (!page) {
      return
    }

    clearTimeout(this.idle)
    page.control = "user"
    this.publish()
  }

  private returnControl() {
    const page = this.page

    if (!page) {
      return
    }

    page.control = "agent"
    page.reason = null
    this.park(page)
    this.release()
    this.publish()
    this.scheduleIdle()
  }

  /**
   * Puts the view over the slot the Renderer drew. It waits for the Renderer's bounds: a view covering the whole
   * window makes Chromium count the Renderer as hidden, and a hidden Renderer never draws the slot.
   */
  private place() {
    const page = this.page

    if (page?.control !== "user" || !this.bounds || this.window.isDestroyed()) {
      return
    }

    const [width = 0, height = 0] = this.window.getContentSize()

    if (this.bounds.x + this.bounds.width > width || this.bounds.y + this.bounds.height > height) {
      return
    }

    this.window.contentView.addChildView(page.view)
    page.view.setBounds(this.bounds)
    page.view.webContents.focus()
  }

  /**
   * Keeps the view in the window with all but one pixel outside it, under a cover. Chromium counts a view out of every
   * window, or wholly out of its area, as hidden: it lays it out at 0x0 and drops its input. A view over the whole
   * Renderer hides the Renderer instead, and child views always sit above the Renderer, so it cannot hide behind it.
   */
  private park(page: Page) {
    page.view.setBounds(parked)

    if (!this.window.isDestroyed()) {
      this.window.contentView.addChildView(page.view)
      this.window.contentView.addChildView(page.cover)
      this.window.webContents.focus()
    }
  }

  private async waitForControl(signal: AbortSignal) {
    signal.throwIfAborted()

    if (this.page?.control !== "user") {
      return
    }

    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const timer = setTimeout(() => reject(new Error("The user still has the page. Ask in the chat whether they finished, and call browser again after they answer.")), handoffWaitMs)
    const abort = () => reject(signal.reason)
    this.waiters.add(resolve)
    signal.addEventListener("abort", abort, { once: true })
    await promise.finally(() => {
      clearTimeout(timer)
      this.waiters.delete(resolve)
      signal.removeEventListener("abort", abort)
    })

    if (!this.page) {
      throw new Error("The page was closed.")
    }
  }

  private release() {
    for (const resolve of this.waiters) {
      resolve()
    }
  }

  private scheduleIdle() {
    clearTimeout(this.idle)

    if (this.page?.control !== "agent" || this.running) {
      return
    }

    this.idle = setTimeout(() => this.close(), idleMs)
  }

  private state(): BrowserState | null {
    const page = this.page

    if (!page) {
      return null
    }

    return { url: page.view.webContents.getURL(), title: page.view.webContents.getTitle(), control: page.control, reason: page.reason }
  }

  private publish() {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send("browser:state", this.state())
    }
  }
}
