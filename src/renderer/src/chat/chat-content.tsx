import { isValidElement, memo, type ReactNode, Suspense, use } from "react"
import { createMarkdownRenderer } from "./chat-markdown"

type Highlight = typeof import("./chat-code-highlight").highlightChatCode

let highlighter: Promise<Highlight> | undefined

/** Loads highlight.js on the first code block, so the first render of the window does not pay for it. */
function loadHighlighter() {
  highlighter ??= import("./chat-code-highlight").then((module) => module.highlightChatCode)

  return highlighter
}

/** Only absolute links leave the app; a relative one would resolve against the app itself. */
const externalLink = /^(https?|mailto):/i

const markdown = createMarkdownRenderer({
  cacheBytes: 2_000_000,
  components: {
    a: ({ children, href }) => !href || !externalLink.test(href) ? <span>{children}</span> : <a className="text-primary underline decoration-outline-strong underline-offset-3 hover:decoration-primary focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" href={href} target="_blank" rel="noreferrer">{children}</a>,
    blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-outline-strong pl-4 text-secondary">{children}</blockquote>,
    code: ({ children, className }) => <code className={`${className ?? ""} font-mono text-[0.88em] font-semibold text-inline-code`}>{children}</code>,
    h1: ({ children }) => <h1 className="mt-6 mb-2 text-title font-semibold leading-[1.35] text-primary">{children}</h1>,
    h2: ({ children }) => <h2 className="mt-6 mb-2 text-[17px] font-semibold leading-[1.35] text-primary">{children}</h2>,
    h3: ({ children }) => <h3 className="mt-6 mb-2 text-section font-semibold text-primary">{children}</h3>,
    h4: ({ children }) => <h4 className="mt-6 mb-2 text-section font-semibold text-primary">{children}</h4>,
    hr: () => <hr className="my-6 h-px border-0 bg-outline" />,
    li: ({ children }) => <li className="my-1 p-0 marker:text-muted">{children}</li>,
    ol: ({ children, start }) => <ol start={start} className="my-2 mb-4 list-decimal pl-6">{children}</ol>,
    p: ({ children }) => <p className="mt-0 mb-3">{children}</p>,
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    table: ({ children }) => <div className="my-4 max-w-full overflow-x-auto rounded-xl border border-outline"><table className="w-full border-collapse text-control">{children}</table></div>,
    td: ({ children }) => <td className="border-b border-outline px-3 py-2 text-left whitespace-nowrap [tr:last-child_&]:border-b-0">{children}</td>,
    th: ({ children }) => <th className="border-b border-outline bg-surface-raised px-3 py-2 text-left font-semibold whitespace-nowrap text-secondary">{children}</th>,
    ul: ({ children }) => <ul className="my-2 mb-4 list-disc pl-6">{children}</ul>,
  },
})

/** An assistant reply as Markdown. Links open in the system browser: Main turns their new-window request into an external open. */
export function ChatContent({ content }: { content: string }) {
  return <div className="min-w-0 text-body text-primary [overflow-wrap:anywhere] [&>:first-child]:mt-0 [&>:last-child]:mb-0">{markdown.render(content)}</div>
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const code = isValidElement<{ children?: ReactNode; className?: string }>(children) ? children : undefined
  const language = code?.props.className
  const content = [code?.props.children].flat().filter((part) => typeof part === "string").join("").replace(/\n$/, "")
  const plain = <code className={language}>{content}</code>

  return (
    <div className="chat-code my-4 rounded-xl border border-outline bg-canvas">
      <pre className="m-0 overflow-x-auto rounded-[inherit] p-4">
        {language ? <Suspense fallback={plain}><HighlightedCode content={content} language={language} /></Suspense> : plain}
      </pre>
    </div>
  )
}

/** Memoized so a streaming reply, which renders its finished code blocks again on each flush, does not highlight them again. */
const HighlightedCode = memo(function HighlightedCode({ content, language }: { content: string; language: string }) {
  const html = use(loadHighlighter())(content, language)

  if (!html) {
    return <code className={language}>{content}</code>
  }

  return <code className={language} dangerouslySetInnerHTML={{ __html: html }} />
})
