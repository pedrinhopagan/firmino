import type { ComponentProps, FocusEvent, MouseEvent, PointerEvent, ReactNode } from "react"
import { Tooltip, type TooltipPlacement, useTooltip } from "./tooltip"

type IconButtonProps = Omit<ComponentProps<"button">, "aria-label"> & {
  children: ReactNode
  label: string
  tooltipPlacement?: TooltipPlacement
}

const iconButtonClassName = "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64 [&>svg]:size-4"

export function IconButton({ children, className, label, onClick, onBlur, onPointerLeave, tooltipPlacement = "top", type = "button", ...props }: IconButtonProps) {
  const tooltip = useTooltip()

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    tooltip.hide()
    onClick?.(event)
  }

  // The tooltip hides on these too, so the caller's handlers run after its own instead of being replaced.
  function handleBlur(event: FocusEvent<HTMLButtonElement>) {
    tooltip.hide()
    onBlur?.(event)
  }

  function handlePointerLeave(event: PointerEvent<HTMLButtonElement>) {
    tooltip.hide()
    onPointerLeave?.(event)
  }

  return (
    <>
      <button {...props} type={type} {...tooltip.anchorProps} className={[iconButtonClassName, className].filter(Boolean).join(" ")} aria-label={label} onClick={handleClick} onBlur={handleBlur} onPointerLeave={handlePointerLeave}>
        {children}
      </button>
      <Tooltip {...tooltip.popoverProps} placement={tooltipPlacement}>{label}</Tooltip>
    </>
  )
}
