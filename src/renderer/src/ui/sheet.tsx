import type { MouseEvent, ReactNode, Ref } from "react"

const panelClassNames = {
  /** A screen that slides in from the right over the chat column: the whole window, or only the chat beside the agent's page. */
  right: "ml-auto h-full w-full max-w-100 translate-x-full overflow-clip bg-background group-open:translate-x-0 starting:group-open:translate-x-full",
  /** A card just above the bottom edge. */
  bottom: "mx-3 mt-auto mb-3 translate-y-3 rounded-xl border bg-popover opacity-0 shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] group-open:translate-y-0 group-open:opacity-100 starting:group-open:translate-y-3 starting:group-open:opacity-0",
}

function closeOnDimmedArea(event: MouseEvent<HTMLDialogElement>) {
  if (event.target === event.currentTarget) {
    event.currentTarget.close()
  }
}

/**
 * A modal layer over the whole window, on the native dialog: it holds the focus, closes on Escape or a click on the dimmed area, and slides its panel in and out.
 * Open it with `showModal()` on the ref. It covers the header, so it opts out of the window's drag region, and it draws the window's border again over its own dimmed area.
 */
export function Sheet({ ref, label, side, children }: { ref: Ref<HTMLDialogElement>; label: string; side: keyof typeof panelClassNames; children: ReactNode }) {
  return (
    <dialog
      ref={ref}
      aria-label={label}
      className="group fixed inset-0 m-0 size-full max-h-none max-w-none flex-col overflow-clip rounded-shell border bg-transparent p-0 text-foreground transition-[background-color,display,overlay] transition-discrete duration-200 ease-out backdrop:bg-transparent open:flex open:bg-black/40 starting:open:bg-transparent motion-reduce:transition-none [-webkit-app-region:no-drag]"
      onClick={closeOnDimmedArea}
    >
      <div className={`flex min-h-0 flex-col transition-[translate,opacity] duration-200 ease-out motion-reduce:transition-none ${panelClassNames[side]}`}>
        {children}
      </div>
    </dialog>
  )
}
