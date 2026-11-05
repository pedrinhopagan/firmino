import type { ReactNode } from "react"

/** The card a settings section groups its rows in; each row after the first gets a divider. */
export const settingsGroupClassName = "flex flex-col rounded-lg border bg-card [&>*+*]:border-t"

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5" aria-label={title}>
      <h2 className="m-0 px-1 text-sm font-normal text-foreground/70">{title}</h2>
      {children}
    </section>
  )
}

export function SettingsRow({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="m-0 text-sm font-medium text-foreground">{title}</p>
        {description && <p className="m-0 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  )
}
