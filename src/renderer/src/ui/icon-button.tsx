import type { ComponentProps, MouseEvent, ReactNode } from "react"
import { Tooltip, type TooltipPlacement, useTooltip } from "./tooltip"

type IconButtonProps = Omit<ComponentProps<"button">, "aria-label"> & {
  children: ReactNode
  label: string
  tone?: "ghost" | "window-close"
  tooltipPlacement?: TooltipPlacement
}

const toneClassNames = {
  ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
  "window-close": "text-muted-foreground hover:bg-destructive/12 hover:text-destructive-foreground",
}

const iconButtonClassName = "grid size-7 shrink-0 place-items-center rounded-md outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64 [&>svg]:size-4"

export function IconButton({ children, className, label, onClick, tone = "ghost", tooltipPlacement = "top", type = "button", ...props }: IconButtonProps) {
  const tooltip = useTooltip()

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    tooltip.hide()
    onClick?.(event)
  }

  return (
    <>
      <button {...props} type={type} {...tooltip.anchorProps} className={[iconButtonClassName, toneClassNames[tone], className].filter(Boolean).join(" ")} aria-label={label} onClick={handleClick}>
        {children}
      </button>
      <Tooltip {...tooltip.popoverProps} placement={tooltipPlacement}>{label}</Tooltip>
    </>
  )
}
