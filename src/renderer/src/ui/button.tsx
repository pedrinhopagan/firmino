import type { ComponentProps } from "react"

type ButtonProps = ComponentProps<"button"> & { variant?: "primary" | "secondary" | "ghost" | "danger" }

const baseClassName = "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64"

const variantClassNames = {
  primary: "border-primary bg-primary text-primary-foreground shadow-xs hover:border-primary-hover hover:bg-primary-hover",
  secondary: "border-input bg-popover text-foreground shadow-xs/5 hover:bg-accent",
  ghost: "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
  danger: "border-input bg-popover text-destructive-foreground shadow-xs/5 hover:border-destructive/32 hover:bg-destructive/4",
}

export function Button({ variant = "primary", className, type = "button", ...props }: ButtonProps) {
  return <button {...props} type={type} className={[baseClassName, variantClassNames[variant], className].filter(Boolean).join(" ")} />
}
