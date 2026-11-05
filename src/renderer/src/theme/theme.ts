import { Store } from "@tanstack/react-store"
import { themes } from "./theme-palettes"

export const themeModes = ["system", "light", "dark"] as const

export type ThemeId = (typeof themes)[number]["id"]
export type ThemeMode = (typeof themeModes)[number]
export type ThemeAppearance = Exclude<ThemeMode, "system">

const themeStorageKey = "kolega.theme"
const modeStorageKey = "kolega.theme-mode"
const systemDark = window.matchMedia("(prefers-color-scheme: dark)")

function readTheme(): ThemeId {
  const saved = localStorage.getItem(themeStorageKey)

  return themes.find((theme) => theme.id === saved)?.id ?? "default"
}

function readMode(): ThemeMode {
  const saved = localStorage.getItem(modeStorageKey)

  return themeModes.find((mode) => mode === saved) ?? "system"
}

function resolveAppearance(mode: ThemeMode): ThemeAppearance {
  if (mode !== "system") {
    return mode
  }

  if (systemDark.matches) {
    return "dark"
  }

  return "light"
}

/** The theme and mode the user chose, kept in this computer's browser storage like the other window preferences. */
export const themeStore = new Store({ theme: readTheme(), mode: readMode(), appearance: resolveAppearance(readMode()) })

export function setTheme(theme: ThemeId) {
  localStorage.setItem(themeStorageKey, theme)
  themeStore.setState((state) => ({ ...state, theme }))
}

export function setThemeMode(mode: ThemeMode) {
  localStorage.setItem(modeStorageKey, mode)
  themeStore.setState((state) => ({ ...state, mode, appearance: resolveAppearance(mode) }))
}

type Palette = Readonly<Record<string, string>>

/** A theme saved with one appearance only wears it in both modes. */
export function themeVariant(theme: { id: string; light?: Palette; dark?: Palette }, appearance: ThemeAppearance) {
  const other = appearance === "dark" ? "light" : "dark"
  const colors = theme[appearance]

  if (colors) {
    return { appearance, colors }
  }

  const fallback = theme[other]

  if (!fallback) {
    throw new Error(`Theme ${theme.id} has no colors`)
  }

  return { appearance: other, colors: fallback }
}

function paint({ theme, appearance }: Pick<typeof themeStore.state, "theme" | "appearance">) {
  const root = document.documentElement
  const variant = themeVariant(themes.find((candidate) => candidate.id === theme) ?? themes[0], appearance)

  root.style.colorScheme = variant.appearance

  for (const [token, color] of Object.entries(variant.colors)) {
    root.style.setProperty(`--${token}`, color)
  }
}

/** Paints the chosen theme on the document now and again whenever the choice or the system appearance changes. */
export function startTheme() {
  paint(themeStore.state)
  themeStore.subscribe(paint)
  systemDark.addEventListener("change", () => themeStore.setState((state) => ({ ...state, appearance: resolveAppearance(state.mode) })))
}
