import { isValidElement, memo, type ReactNode, Suspense, use } from "react"
import { ChatImage } from "./chat-image"
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
    a: ({ children, href }) => !href || !externalLink.test(href) ? <span>{children}</span> : <a className="text-link underline-offset-3 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={href} target="_blank" rel="noreferrer">{children}</a>,
    blockquote: ({ children }) => <blockquote className="my-2.5 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
    code: ({ children, className }) => <code className={`${className ?? ""} rounded-sm border bg-muted px-1 py-px font-mono text-xs text-foreground`}>{children}</code>,
    h1: ({ children }) => <h1 className="mt-5 mb-2 text-xl leading-tight font-semibold">{children}</h1>,
    h2: ({ children }) => <h2 className="mt-5 mb-2 text-lg leading-tight font-semibold">{children}</h2>,
    h3: ({ children }) => <h3 className="mt-5 mb-2 text-base leading-tight font-semibold">{children}</h3>,
    h4: ({ children }) => <h4 className="mt-5 mb-2 text-sm leading-tight font-semibold">{children}</h4>,
    hr: () => <hr className="my-5 h-px border-0 bg-border" />,
    img: ({ src, alt }) => src ? <ChatImage src={String(src)} alt={alt ?? ""} /> : null,
    li: ({ children }) => <li className="p-0 marker:text-muted-foreground [&+&]:mt-1">{children}</li>,
    ol: ({ children, start }) => <ol start={start} className="my-2.5 list-decimal pl-5">{children}</ol>,
    p: ({ children }) => <p className="my-2.5">{children}</p>,
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    table: ({ children }) => <div className="my-2.5 max-w-full overflow-x-auto rounded-md border"><table className="w-full border-collapse text-xs">{children}</table></div>,
    td: ({ children }) => <td className="border-b px-2.5 py-1.5 text-left whitespace-nowrap [tr:last-child_&]:border-b-0">{children}</td>,
    th: ({ children }) => <th className="border-b bg-muted px-2.5 py-1.5 text-left font-medium whitespace-nowrap text-muted-foreground">{children}</th>,
    ul: ({ children }) => <ul className="my-2.5 list-disc pl-5">{children}</ul>,
  },
})

/** An assistant reply as Markdown. Links open in the system browser: Main turns their new-window request into an external open. */
export function ChatContent({ content }: { content: string }) {
  return <div className="min-w-0 text-sm leading-relaxed text-foreground [overflow-wrap:anywhere] [&>:first-child]:mt-0 [&>:last-child]:mb-0">{markdown.render(content)}</div>
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const code = isValidElement<{ children?: ReactNode; className?: string }>(children) ? children : undefined
  const language = code?.props.className
  const content = [code?.props.children].flat().filter((part) => typeof part === "string").join("").replace(/\n$/, "")
  const plain = <code className={language}>{content}</code>

  return (
    <div className="chat-code my-2.5 rounded-md border bg-code">
      <pre className="m-0 overflow-x-auto rounded-[inherit] px-3 py-2.5">
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
