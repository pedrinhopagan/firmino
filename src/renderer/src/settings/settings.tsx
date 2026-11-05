import { CheckIcon, ComputerDesktopIcon, MoonIcon, SunIcon } from "@heroicons/react/16/solid"
import { useStore } from "@tanstack/react-store"
import { useState } from "react"
import { Connections } from "../connections/connections"
import type { EngineClient } from "../engine-client"
import { setTheme, setThemeMode, type ThemeMode, themeModes, themeStore, themeVariant } from "../theme/theme"
import { themes } from "../theme/theme-palettes"
import { SettingsSection } from "../ui/settings-section"
import { ProviderAccounts } from "./provider-accounts"

const sections = [{ id: "appearance", label: "Aparência" }, { id: "providers", label: "Provedores" }, { id: "connections", label: "Conexões" }] as const

/** The settings route: one tab per section, the way T3 Code lists its settings pages. */
export function Settings({ client }: { client: EngineClient }) {
  const [section, setSection] = useState<(typeof sections)[number]["id"]>("appearance")

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <nav className="flex shrink-0 gap-1 border-b px-3 py-2" aria-label="Seções">
        {sections.map(({ id, label }) => (
          <button key={id} type="button" className="h-7 rounded-md px-2.5 text-sm font-medium text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-accent aria-[current=page]:text-foreground" aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-140 flex-col gap-6 px-3 pt-4 pb-6">
          {section === "appearance" && <Appearance />}
          {section === "providers" && <ProviderAccounts client={client} />}
          {section === "connections" && <Connections client={client} />}
        </div>
      </div>
    </div>
  )
}

const modeOptions: Record<ThemeMode, { label: string; icon: typeof SunIcon }> = {
  system: { label: "Sistema", icon: ComputerDesktopIcon },
  light: { label: "Claro", icon: SunIcon },
  dark: { label: "Escuro", icon: MoonIcon },
}

function Appearance() {
  const { theme, mode, appearance } = useStore(themeStore, (state) => state)

  return (
    <>
      <SettingsSection title="Modo">
        <div className="grid grid-cols-3 gap-0.5 rounded-lg border bg-muted/40 p-0.5" role="group" aria-label="Modo">
          {themeModes.map((option) => {
            const Icon = modeOptions[option].icon

            return (
              <button key={option} type="button" className="flex h-7 items-center justify-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs" aria-pressed={mode === option} onClick={() => setThemeMode(option)}>
                <Icon className="size-3.5" aria-hidden="true" />
                {modeOptions[option].label}
              </button>
            )
          })}
        </div>
      </SettingsSection>
      <SettingsSection title="Tema">
        <div className="grid grid-cols-2 gap-2">
          {themes.map((candidate) => {
            const { colors } = themeVariant(candidate, appearance)
            const active = candidate.id === theme

            return (
              <button key={candidate.id} type="button" className="flex flex-col gap-2 rounded-lg border bg-card p-1.5 text-left outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-ring aria-pressed:bg-accent/30" aria-pressed={active} onClick={() => setTheme(candidate.id)}>
                <span className="flex h-16 flex-col justify-between rounded-md border p-1.5" style={{ background: colors.background, borderColor: colors.border }} aria-hidden="true">
                  <span className="h-2.5 w-3/5 self-end rounded-sm" style={{ background: colors.message }} />
                  <span className="flex h-4.5 items-center justify-end rounded-sm border px-0.5" style={{ background: colors["surface-raised"], borderColor: colors.border }}>
                    <span className="size-3 rounded-[3px]" style={{ background: colors.primary }} />
                  </span>
                </span>
                <span className="flex items-center gap-1 px-0.5 text-xs font-medium text-foreground">
                  <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
                  {active && <CheckIcon className="size-3.5 shrink-0" aria-hidden="true" />}
                </span>
              </button>
            )
          })}
        </div>
      </SettingsSection>
    </>
  )
}
