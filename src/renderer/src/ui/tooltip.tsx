import { type CSSProperties, type FocusEvent, type ReactNode, type Ref, useId, useRef } from "react"

export type TooltipPlacement = "top" | "right" | "bottom" | "left"

const placementClassNames: Record<TooltipPlacement, string> = {
  top: "[position-area:top] mb-1 starting:translate-y-0.5",
  right: "[position-area:right] ml-1 starting:-translate-x-0.5",
  bottom: "[position-area:bottom] mt-1 starting:-translate-y-0.5",
  left: "[position-area:left] mr-1 starting:translate-x-0.5",
}

// Once a tooltip closes, its neighbours open at once for a short while.
const warmth = { until: 0 }

export function useTooltip() {
  const anchorName = `--tooltip-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`
  const popoverRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = () => {
    clearTimeout(timerRef.current)
    popoverRef.current?.toggleAttribute("data-instant", performance.now() < warmth.until)
    popoverRef.current?.showPopover()
  }
  const hide = () => {
    clearTimeout(timerRef.current)

    if (popoverRef.current?.matches(":popover-open")) {
      warmth.until = performance.now() + 800
    }

    popoverRef.current?.hidePopover()
  }
  const showAfterDelay = () => {
    if (!window.matchMedia("(hover: hover)").matches) {
      return
    }

    clearTimeout(timerRef.current)

    if (performance.now() < warmth.until) {
      show()
      return
    }

    timerRef.current = setTimeout(show, 500)
  }
  const showOnKeyboardFocus = (event: FocusEvent<HTMLElement>) => {
    const keyboardFocus = event.currentTarget.matches(":focus-visible")

    if (keyboardFocus) {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(show, 0)
    }
  }

  return {
    focusProps: { onFocus: showOnKeyboardFocus, onBlur: hide },
    anchorProps: { style: { anchorName } satisfies CSSProperties, onPointerEnter: showAfterDelay, onPointerLeave: hide, onFocus: showOnKeyboardFocus, onBlur: hide },
    popoverProps: { anchorName, ref: popoverRef },
    hide,
  }
}

export function Tooltip({ anchorName, children, placement = "top", ref }: { anchorName: string; children: ReactNode; placement?: TooltipPlacement; ref: Ref<HTMLDivElement> }) {
  return (
    <div
      className={`pointer-events-none inset-auto m-0 w-max max-w-80 rounded-md border bg-popover px-2 py-1 text-xs leading-snug whitespace-normal text-foreground shadow-md/5 transition-[opacity,transform,display,overlay] transition-discrete duration-120 ease-out [position-try-fallbacks:flip-block,flip-inline] starting:opacity-0 data-instant:transition-none motion-reduce:transition-none ${placementClassNames[placement]}`}
      popover="manual"
      ref={ref}
      role="tooltip"
      style={{ positionAnchor: anchorName }}
    >
      {children}
    </div>
  )
}
