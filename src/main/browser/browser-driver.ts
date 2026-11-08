import { once } from "node:events"
import { setTimeout as sleep } from "node:timers/promises"
import type { WebContents } from "electron"
import { z } from "zod"
import type { BrowserAction } from "@src/shared/browser"
import { parse } from "@src/shared/parse"

/** One snapshot's page content, element names included, stops at this many characters. */
const snapshotBudget = 12_000
const maxNameLength = 150
/** A scroll moves this share of the viewport, so consecutive snapshots overlap a little. */
const scrollShare = 0.8
const loadTimeoutMs = 30_000
const settleMs = 400
const keys = {
  Enter: { code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Tab: { code: "Tab", windowsVirtualKeyCode: 9 },
  Escape: { code: "Escape", windowsVirtualKeyCode: 27 },
  ArrowDown: { code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowUp: { code: "ArrowUp", windowsVirtualKeyCode: 38 },
  Backspace: { code: "Backspace", windowsVirtualKeyCode: 8 },
}

/**
 * Runs in the page, in Firmino's isolated world: the text and the interactive elements inside the viewport, in document
 * order, each element inline as `[@eN role "name"]`. The elements stay in the world for click and fill; the page's own
 * scripts cannot see them. The walk stops once the content reaches the budget.
 */
const snapshotInPage = String((budget: number, nameLength: number) => {
  const interactive = "a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=combobox],[role=listbox],[role=slider],[role=spinbutton],[role=textbox],[role=searchbox],[contenteditable=''],[contenteditable=true]"
  const tagRoles: Record<string, string> = { A: "link", BUTTON: "button", TEXTAREA: "textbox", SELECT: "combobox", SUMMARY: "button" }
  const inputRoles: Record<string, string> = { checkbox: "checkbox", radio: "radio", submit: "button", button: "button", reset: "button", search: "searchbox", range: "slider", number: "spinbutton" }
  const references: Element[] = []
  const lines: string[] = []
  const height = innerHeight
  let line = ""
  let size = 0
  let block: Element | null = null
  Reflect.set(globalThis, "firminoReferences", references)

  const clean = (text: string) => text.replace(/\s+/g, " ").trim()
  const inView = (rect: DOMRect) => rect.bottom > 0 && rect.top < height && rect.width > 0 && rect.height > 0
  /** Chunks larger than this are cut to the characters inside the viewport, so scrolling a long plain text moves on. */
  const longText = 2_000
  const field = (element: Element) => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement

  function blockOf(node: Node) {
    let element = node.parentElement

    while (element && getComputedStyle(element).display.startsWith("inline")) {
      element = element.parentElement
    }

    return element
  }

  function flush() {
    const text = line.trim()

    if (text) {
      lines.push(text)
      size += text.length + 1
    }

    line = ""
  }

  /** Starts a new line when the node sits in another block; a heading's line starts with its level in #. */
  function place(node: Node) {
    const current = blockOf(node)

    if (current === block) {
      return
    }

    flush()
    block = current
    const level = current?.tagName.match(/^H([1-6])$/)?.[1]

    if (level) {
      line = `${"#".repeat(Number(level))} `
    }
  }

  function name(element: Element) {
    const scope = element.getRootNode()
    const labelledBy = element.getAttribute("aria-labelledby")?.split(" ").map((id) => (scope instanceof ShadowRoot ? scope : document).getElementById(id)?.textContent ?? "").join(" ")
    const labels = field(element) && "labels" in element ? [...element.labels ?? []].map((label) => label.textContent ?? "").join(" ") : ""
    const candidates = [element.getAttribute("aria-label"), labelledBy, labels, element instanceof HTMLElement ? element.innerText : "", element.querySelector("img[alt]")?.getAttribute("alt"), element.getAttribute("placeholder"), element.getAttribute("title")]

    return clean(candidates.find((candidate) => !!candidate?.trim()) ?? "").slice(0, nameLength)
  }

  function role(element: Element) {
    if (element.getAttribute("role")) {
      return element.getAttribute("role")
    }

    if (element instanceof HTMLInputElement) {
      return inputRoles[element.type] ?? "textbox"
    }

    if (element instanceof HTMLSelectElement && (element.multiple || element.size > 1)) {
      return "listbox"
    }

    return tagRoles[element.tagName] ?? "textbox"
  }

  function state(element: Element) {
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
      if (element.checked) {
        return " checked"
      }

      return " unchecked"
    }

    if (!field(element) || !("value" in element) || !element.value) {
      return ""
    }

    // A password the user typed during a handoff stays out of the agent's view.
    if (element instanceof HTMLInputElement && element.type === "password") {
      return " value=[hidden]"
    }

    return ` value="${clean(element.value).slice(0, nameLength)}"`
  }

  /** Text, script and hidden subtrees are left out; a box-less wrapper such as `display: contents` is walked through, shadow root included. */
  function accept(node: Node) {
    if (!(node instanceof Element)) {
      return NodeFilter.FILTER_ACCEPT
    }

    if (node.matches("script,style,noscript,template,svg,iframe")) {
      return NodeFilter.FILTER_REJECT
    }

    if (node.checkVisibility() || getComputedStyle(node).display === "contents") {
      return NodeFilter.FILTER_ACCEPT
    }

    return NodeFilter.FILTER_REJECT
  }

  /** The bottom edge of the text up to `end`, which grows with `end`. */
  function bottomUntil(node: Text, end: number) {
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, end)

    return range.getBoundingClientRect().bottom
  }

  /** The first offset whose text so far reaches below `edge`. */
  function offsetBelow(node: Text, edge: number) {
    let low = 1
    let high = node.length

    while (low < high) {
      const middle = Math.floor((low + high) / 2)

      if (bottomUntil(node, middle) > edge) {
        high = middle
      } else {
        low = middle + 1
      }
    }

    return low
  }

  /** The part of a text node inside the viewport: all of it when short or wholly in view. */
  function visibleText(node: Text, rect: DOMRect) {
    if (node.length <= longText || (rect.top >= 0 && rect.bottom <= height)) {
      return node.data
    }

    return node.data.slice(rect.top >= 0 ? 0 : offsetBelow(node, 0) - 1, rect.bottom <= height ? node.length : offsetBelow(node, height))
  }

  /** The next node after this one's subtree. */
  function skip(walker: TreeWalker) {
    while (!walker.nextSibling()) {
      if (!walker.parentNode()) {
        return null
      }
    }

    return walker.currentNode
  }

  /** Walks a document or an open shadow root, entering the shadow roots inside it; false once the budget is spent. */
  function walk(root: Node): boolean {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: accept })
    let node = walker.nextNode()

    while (node) {
      if (size + line.length >= budget) {
        return false
      }

      if (node instanceof Element) {
        const element = node
        const referenced = element.matches(interactive) && inView(element.getBoundingClientRect())

        if (referenced) {
          place(element)
          references.push(element)
          line += ` [@e${references.length} ${role(element)} "${name(element)}"${state(element)}] `
        }

        // A host's shadow root comes first, even for an interactive host, whose options or inputs may live there.
        if (element.shadowRoot && !walk(element.shadowRoot)) {
          return false
        }

        if (referenced) {
          // A container such as a listbox keeps its options; any other element's text is its name.
          node = element.querySelector(interactive) ? walker.nextNode() : skip(walker)

          continue
        }
      }

      if (node instanceof Text) {
        const range = document.createRange()
        range.selectNodeContents(node)
        const rect = range.getBoundingClientRect()

        if (inView(rect)) {
          const text = clean(visibleText(node, rect))

          if (text) {
            place(node)
            line += `${text} `
          }
        }
      }

      node = walker.nextNode()
    }

    return true
  }

  const cut = !walk(document.body ?? document.documentElement)
  flush()

  return { content: lines.join("\n").slice(0, budget), cut, top: Math.round(scrollY), height, total: document.documentElement.scrollHeight }
})

/** Runs in the page: the key as page events, then what Chromium would do by default for Enter in a form and for Backspace. */
const pressInPage = String((definition: { key: string; code: string }) => {
  const element = document.activeElement ?? document.body
  const init = { key: definition.key, code: definition.code, bubbles: true, cancelable: true }
  const proceed = element.dispatchEvent(new KeyboardEvent("keydown", init))
  element.dispatchEvent(new KeyboardEvent("keyup", init))

  if (proceed && definition.key === "Enter" && "form" in element && element.form instanceof HTMLFormElement) {
    element.form.requestSubmit()
  }

  if (proceed && definition.key === "Backspace") {
    document.execCommand("delete")
  }
})
const frameTree = z.object({ frameTree: z.object({ frame: z.object({ id: z.string() }) }) })
const isolatedWorld = z.object({ executionContextId: z.int() })
const quads = z.object({ quads: z.array(z.array(z.number()).length(8)) })
const remoteObject = z.object({ result: z.object({ objectId: z.string().optional() }) })
const evaluation = z.object({ result: z.object({ value: z.unknown().optional() }) })
const snapshotResult = z.object({ content: z.string(), cut: z.boolean(), top: z.number(), height: z.number(), total: z.number() })

/**
 * Drives one page through Electron's in-process CDP client, so no debugging port opens.
 * A snapshot reads the viewport and names each interactive element `@eN`; the names last until the next snapshot.
 */
export class BrowserDriver {
  /** The isolated world of the last snapshot, which holds its elements; a navigation ends it. */
  private world?: number

  constructor(private readonly contents: WebContents) {}

  /** Runs one action and answers with the viewport as it stands after it. The signal stops it between CDP calls. */
  async execute(input: Exclude<BrowserAction, { action: "handoff" | "close" }>, signal: AbortSignal) {
    if (input.action === "navigate") {
      await this.navigate(input.url, signal)
    } else if (input.action === "click") {
      await this.click(input.target, signal)
    } else if (input.action === "fill") {
      await this.fill(input.target, input.text, signal)
    } else if (input.action === "press") {
      await this.press(input.key, signal)
    } else if (input.action === "scroll") {
      await this.send(signal, "Runtime.evaluate", { expression: `scrollBy(0, ${input.direction === "down" ? "" : "-"}Math.round(innerHeight * ${scrollShare}))` })
    }

    await this.settle(signal)

    return this.snapshot(signal)
  }

  close() {
    if (this.contents.isDestroyed() || !this.contents.debugger.isAttached()) {
      return
    }

    this.contents.debugger.detach()
  }

  private async send(signal: AbortSignal, method: string, params?: object): Promise<unknown> {
    signal.throwIfAborted()

    if (!this.contents.debugger.isAttached()) {
      this.contents.debugger.attach("1.3")
    }

    return await this.contents.debugger.sendCommand(method, params)
  }

  private async navigate(url: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const loading = this.contents.loadURL(url).catch((error: unknown) => {
      // A redirect done by the page itself aborts the first load; the page still arrives.
      if (error instanceof Error && error.message.includes("ERR_ABORTED")) {
        return
      }

      throw error
    })
    await Promise.race([loading, sleep(loadTimeoutMs, undefined, { signal })])
  }

  /** Waits for a navigation an action started, so the snapshot reads the page it led to. */
  private async settle(signal: AbortSignal) {
    await sleep(settleMs, undefined, { signal })

    if (this.contents.isLoading()) {
      await once(this.contents, "did-stop-loading", { signal: AbortSignal.any([signal, AbortSignal.timeout(loadTimeoutMs)]) }).catch(() => {})
    }
  }

  /** The element a name of the last snapshot points to, while it is still on the page. */
  private async element(target: string, signal: AbortSignal) {
    const gone = new Error(`${target} is no longer on the page. Take a fresh snapshot.`)

    if (this.world === undefined) {
      throw gone
    }

    const index = Number(target.slice(2)) - 1
    const found = await this.send(signal, "Runtime.evaluate", { expression: `globalThis.firminoReferences?.[${index}]?.isConnected ? globalThis.firminoReferences[${index}] : undefined`, contextId: this.world }).catch(() => {
      throw gone
    })
    const { objectId } = parse(remoteObject, found).result

    if (!objectId) {
      throw gone
    }

    return { objectId }
  }

  private async click(target: string, signal: AbortSignal) {
    const node = await this.element(target, signal)
    await this.send(signal, "DOM.scrollIntoViewIfNeeded", node)
    const box = parse(quads, await this.send(signal, "DOM.getContentQuads", node)).quads[0]

    if (!box || await this.hidden(signal)) {
      await this.send(signal, "Runtime.callFunctionOn", { ...node, functionDeclaration: "function () { this.click() }" })

      return
    }

    const x = (box[0] + box[2] + box[4] + box[6]) / 4
    const y = (box[1] + box[3] + box[5] + box[7]) / 4
    await this.send(signal, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
    await this.send(signal, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 })
    await this.send(signal, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 })
  }

  private async fill(target: string, text: string, signal: AbortSignal) {
    const node = await this.element(target, signal)
    await this.send(signal, "DOM.focus", node)
    await this.send(signal, "Runtime.callFunctionOn", { ...node, functionDeclaration: "function () { if (typeof this.select === 'function') { this.select() } else { document.execCommand('selectAll') } }" })

    if (!text) {
      await this.press("Backspace", signal)

      return
    }

    await this.send(signal, "Input.insertText", { text })
  }

  private async press(key: keyof typeof keys, signal: AbortSignal) {
    const definition = { key, ...keys[key] }

    if (await this.hidden(signal)) {
      await this.send(signal, "Runtime.evaluate", { expression: `(${pressInPage})(${JSON.stringify(definition)})` })

      return
    }

    await this.send(signal, "Input.dispatchKeyEvent", { type: "keyDown", ...definition })
    await this.send(signal, "Input.dispatchKeyEvent", { type: "keyUp", key, code: definition.code, windowsVirtualKeyCode: definition.windowsVirtualKeyCode })
  }

  /** A page whose window is hidden gets no input from Chromium, so actions fall back to the page's own events. */
  private async hidden(signal: AbortSignal) {
    return parse(evaluation, await this.send(signal, "Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true })).result.value === "hidden"
  }

  private async snapshot(signal: AbortSignal) {
    const { frameTree: { frame } } = parse(frameTree, await this.send(signal, "Page.getFrameTree"))
    this.world = parse(isolatedWorld, await this.send(signal, "Page.createIsolatedWorld", { frameId: frame.id, worldName: "firmino" })).executionContextId
    const evaluated = parse(evaluation, await this.send(signal, "Runtime.evaluate", { expression: `(${snapshotInPage})(${snapshotBudget}, ${maxNameLength})`, contextId: this.world, returnByValue: true }))
    const page = parse(snapshotResult, evaluated.result.value)
    const bottom = page.top + page.height
    const position = bottom < page.total ? `showing ${page.top} to ${bottom} of ${page.total} px; scroll down for more` : `showing ${page.top} to ${page.total} of ${page.total} px, the end of the page`

    return [
      `url: ${this.contents.getURL()}`,
      `title: ${this.contents.getTitle()}`,
      position,
      "",
      page.content,
      ...(page.cut ? ["", `[cut at ${snapshotBudget} characters]`] : []),
    ].join("\n")
  }
}
