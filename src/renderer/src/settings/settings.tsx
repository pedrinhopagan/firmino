import { ArrowPathIcon, BoltIcon, CalendarIcon, CheckCircleIcon, CheckIcon, ComputerDesktopIcon, CpuChipIcon, LightBulbIcon, LinkIcon, MoonIcon, SunIcon, SwatchIcon } from "@heroicons/react/16/solid"
import { useStore } from "@tanstack/react-store"
import { Connections } from "../connections/connections"
import { setTheme, setThemeMode, type ThemeMode, themeModes, themeStore, themeVariant } from "../theme/theme"
import { themes } from "../theme/theme-palettes"
import { SettingsSection } from "../ui/settings-section"
import { Appointments } from "./appointments"
import { MemorySettings } from "./memory-settings"
import { ProviderAccounts } from "./provider-accounts"
import { Routines, Schedules } from "./routines"
import { Triggers } from "./triggers"

/** Every page the side menu opens, in the order it lists them. */
export const settingsPages = {
  appearance: { label: "Aparência", description: "Modo e tema", icon: SwatchIcon, Page: Appearance },
  providers: { label: "Fornecedores", description: "Contas do Codex e do Claude", icon: CpuChipIcon, Page: ProviderAccounts },
  connections: { label: "Conexões", description: "WhatsApp, Google e navegador", icon: LinkIcon, Page: Connections },
  memory: { label: "Memória", description: "O que o Kolega anotou sobre você", icon: LightBulbIcon, Page: MemorySettings },
  appointments: { label: "Compromissos", description: "O que você precisa fazer num dia", icon: CheckCircleIcon, Page: Appointments },
  routines: { label: "Rotinas", description: "Tarefas que se repetem", icon: ArrowPathIcon, Page: Routines },
  schedules: { label: "Agendamentos", description: "Tarefas marcadas para um horário", icon: CalendarIcon, Page: Schedules },
  triggers: { label: "Gatilhos", description: "Ações quando chega uma mensagem", icon: BoltIcon, Page: Triggers },
}

export type SettingsPage = keyof typeof settingsPages

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
