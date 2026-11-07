import type { KeyboardEvent } from "react"

/** Arrow keys move between the enabled options of a menu. */
export function moveMenuFocus(event: KeyboardEvent<HTMLElement>) {
  const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]

  if (!step) {
    return
  }

  event.preventDefault()
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role^=menuitem]:not(:disabled)")]
  const next = items.findIndex((item) => item === document.activeElement) + step
  items.at(next % items.length)?.focus()
}
