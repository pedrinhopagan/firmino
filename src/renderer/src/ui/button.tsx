import type { ComponentProps } from "react"

type ButtonProps = ComponentProps<"button"> & { variant?: "primary" | "text" | "danger" }

const baseClassName = "shrink-0 rounded-lg px-3.5 py-2 text-control transition-[color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none"

const variantClassNames = {
  primary: "border-0 bg-accent font-semibold text-accent-ink hover:bg-primary active:bg-focus disabled:bg-surface-active disabled:text-muted",
  text: "border-0 bg-transparent font-medium text-muted hover:bg-surface-hover hover:text-primary focus-visible:bg-surface-hover focus-visible:text-primary active:bg-surface-active disabled:opacity-60",
  danger: "border border-outline-strong bg-transparent font-medium text-status-error hover:bg-surface-hover focus-visible:bg-surface-hover active:bg-surface-active disabled:opacity-60",
}

export function Button({ variant = "primary", className, type = "button", ...props }: ButtonProps) {
  return <button {...props} type={type} className={[baseClassName, variantClassNames[variant], className].filter(Boolean).join(" ")} />
}
