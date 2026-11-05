import type {} from "highlight.js"
import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import css from "highlight.js/lib/languages/css"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import markdown from "highlight.js/lib/languages/markdown"
import python from "highlight.js/lib/languages/python"
import sql from "highlight.js/lib/languages/sql"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"

hljs.registerLanguage("bash", bash)
hljs.registerLanguage("css", css)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("json", json)
hljs.registerLanguage("markdown", markdown)
hljs.registerLanguage("python", python)
hljs.registerLanguage("sql", sql)
hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("xml", xml)
hljs.registerLanguage("yaml", yaml)

hljs.registerAliases(["shell"], { languageName: "bash" })

/** Highlighted HTML for a fenced block, or undefined for an unknown language or one highlight.js fails on, which renders as plain code. */
export function highlightChatCode(content: string, className?: string) {
  const name = className?.match(/(?:^|\s)language-([^\s]+)/)?.[1]?.toLowerCase()

  if (!name || !hljs.getLanguage(name)) {
    return
  }

  try {
    return hljs.highlight(content, { language: name, ignoreIllegals: true }).value
  } catch (error) {
    console.error("Não foi possível destacar o código", error)

    return
  }
}
