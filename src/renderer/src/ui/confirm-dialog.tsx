import type { Ref } from "react"
import { Button } from "./button"
import { Sheet } from "./sheet"

/** Asks before a destructive action. Open it with `showModal()` on the ref; either button closes it, and only the confirm button calls `onConfirm`. */
export function ConfirmDialog({ ref, title, description, confirmLabel, onConfirm }: { ref: Ref<HTMLDialogElement>; title: string; description: string; confirmLabel: string; onConfirm: () => void }) {
  return (
    <Sheet ref={ref} label={title} side="bottom">
      <form method="dialog" className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-sm font-medium text-foreground">{title}</h2>
          <p className="m-0 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="submit" variant="secondary">Cancelar</Button>
          <Button type="submit" variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </form>
    </Sheet>
  )
}
