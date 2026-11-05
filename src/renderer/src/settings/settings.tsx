import { CheckIcon, ComputerDesktopIcon, MoonIcon, SunIcon } from "@heroicons/react/16/solid"
import { useStore } from "@tanstack/react-store"
import { useState } from "react"
import { Connections } from "../connections/connections"
import type { EngineClient } from "../engine-client"
import { setTheme, setThemeMode, type ThemeMode, themeModes, themeStore, themeVariant } from "../theme/theme"
import { themes } from "../theme/theme-palettes"
import { SettingsSection } from "../ui/settings-section"
import { ProviderAccounts } from "./provider-accounts"

const sections = [{ id: "appearance", label: "Aparência" }, { id: "providers", label: "Fornecedores" }, { id: "connections", label: "Conexões" }] as const

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
        <fieldset className="m-0 grid grid-cols-2 gap-1.5 border-0 p-0">
          <legend className="sr-only">Tema</legend>
          {themes.map((candidate) => {
            const { colors } = themeVariant(candidate, appearance)
            const active = candidate.id === theme

            return (
              <label key={candidate.id} className="flex h-10 cursor-pointer items-center gap-2.5 rounded-lg border bg-card px-2.5 text-sm text-foreground transition-colors duration-150 hover:bg-accent has-checked:border-ring has-focus-visible:ring-2 has-focus-visible:ring-ring">
                <input className="sr-only" type="radio" name="theme" value={candidate.id} checked={active} onChange={() => setTheme(candidate.id)} />
                <span className="grid size-6 shrink-0 place-items-center rounded-md border" style={{ background: colors.background, borderColor: colors.border }} aria-hidden="true">
                  <span className="size-2.5 rounded-full" style={{ background: colors.primary }} />
                </span>
                <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
                {active && <CheckIcon className="size-3.5 shrink-0" aria-hidden="true" />}
              </label>
            )
          })}
        </fieldset>
      </SettingsSection>
    </>
  )
}
