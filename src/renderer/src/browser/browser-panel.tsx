import { useCallback } from "react"
import type { BrowserState } from "@src/shared/browser"
import { Button } from "../ui/button"

function host(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The slot Main draws the page over, with the agent's reason and the action that gives the page back. */
export function BrowserPanel({ page }: { page: BrowserState }) {
  const attach = useCallback((element: HTMLDivElement | null) => {
    if (!element) {
      return
    }

    const report = () => {
      const rect = element.getBoundingClientRect()

      void window.desktop.setBrowserBounds({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.floor(rect.width)), height: Math.max(1, Math.floor(rect.height)) }).catch((error: unknown) => {
        console.error("Não foi possível posicionar a página", error)
      })
    }
    const observer = new ResizeObserver(report)
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-2 pb-2" aria-label="Página do Firmino">
      <div className="flex min-h-12 items-center gap-3 py-1.5 pr-2 pl-3 [-webkit-app-region:drag]">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="m-0 line-clamp-2 text-sm text-foreground" title={page.reason ?? undefined}>{page.reason ?? "Você está com a página. O Firmino espera você devolver o controle."}</p>
          <p className="m-0 truncate text-2xs text-muted-foreground" title={page.url}>{page.title ? `${page.title} · ${host(page.url)}` : host(page.url)}</p>
        </div>
        <Button className="[-webkit-app-region:no-drag]" onClick={() => void window.desktop.returnBrowserControl()}>Devolver controle</Button>
      </div>
      <div ref={attach} className="mx-2 min-h-0 flex-1 rounded-md border bg-card" />
    </section>
  )
}
