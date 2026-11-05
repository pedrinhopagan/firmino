import type { Nodes } from "hast"
import { type Components, toJsxRuntime } from "hast-util-to-jsx-runtime"
import type { ReactElement } from "react"
import { Fragment, jsx, jsxs } from "react/jsx-runtime"
import { fromMarkdown } from "mdast-util-from-markdown"
import { gfmFromMarkdown } from "mdast-util-gfm"
import { toHast } from "mdast-util-to-hast"
import { gfm } from "micromark-extension-gfm"
import { visit } from "unist-util-visit"

const urlProperties = ["href", "src"] as const
const urlDelimiters = ["/", "?", "#"]
const safeProtocol = /^(https?|mailto)$/i

/** Keeps relative URLs and the safe protocols; anything else, such as `javascript:`, becomes empty. */
function safeUrl(value: string) {
  const colon = value.indexOf(":")
  const firstDelimiter = Math.min(...urlDelimiters.map((mark) => value.indexOf(mark)).filter((index) => index !== -1))
  const relative = colon === -1 || colon > firstDelimiter

  if (relative || safeProtocol.test(value.slice(0, colon))) {
    return value
  }

  return ""
}

/** Markdown to React elements, with raw HTML shown as text and unsafe URLs removed; results are cached by content up to `cacheBytes`. */
export function createMarkdownRenderer({ components, cacheBytes }: { components: Partial<Components>; cacheBytes: number }) {
  const extensions = [gfm()]
  const mdastExtensions = [gfmFromMarkdown()]
  const cache = new Map<string, ReactElement>()
  let cachedBytes = 0

  function parse(content: string) {
    const tree: Nodes = toHast(fromMarkdown(content, { extensions, mdastExtensions }), { allowDangerousHtml: true })

    visit(tree, (node, index, parent) => {
      if (node.type === "raw" && parent && typeof index === "number") {
        parent.children[index] = { type: "text", value: node.value }

        return index
      }

      if (node.type === "element") {
        for (const property of urlProperties) {
          if (Object.hasOwn(node.properties, property)) {
            node.properties[property] = safeUrl(String(node.properties[property] ?? ""))
          }
        }
      }

      return
    })

    return toJsxRuntime(tree, { Fragment, components, ignoreInvalidStyle: true, jsx, jsxs, passKeys: true })
  }

  function remember(content: string, element: ReactElement) {
    cache.set(content, element)
    cachedBytes += content.length

    for (const [oldest] of cache) {
      if (cachedBytes <= cacheBytes) {
        return
      }

      cache.delete(oldest)
      cachedBytes -= oldest.length
    }
  }

  function render(content: string) {
    const cached = cache.get(content)

    if (cached) {
      return cached
    }

    const element = parse(content)
    remember(content, element)

    return element
  }

  return { render }
}
