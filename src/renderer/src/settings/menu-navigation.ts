import { Store } from "@tanstack/react-store"
import { createContext, useContext } from "react"
import type { SettingsPage } from "./settings"

/** The screen of one Compromisso, by its id. */
export type AppointmentScreen = `appointment:${string}`

/** A screen of the side menu: one of its lists, a settings page, or one Compromisso. */
export type MenuScreen = "menu" | "management" | SettingsPage | AppointmentScreen

/** A trail the menu opens on from outside it, as a Compromisso's card asks. Every request is a new object. */
export const menuRequest = new Store<{ trail?: MenuScreen[] }>({})

/** Opens the menu on one Compromisso, under Gerenciamento and Compromissos. */
export function openAppointment(id: string) {
  menuRequest.setState(() => ({ trail: ["menu", "management", "appointments", `appointment:${id}`] }))
}

interface MenuNavigation {
  /** Shows a screen in place of the current one. The element that opens it carries `data-screen`, so going back focuses it again. */
  push: (screen: MenuScreen) => void
  back: () => void
}

export const MenuNavigationContext = createContext<MenuNavigation | undefined>(undefined)

/** How a page inside the side menu moves to another screen. */
export function useMenuNavigation() {
  const navigation = useContext(MenuNavigationContext)

  if (!navigation) {
    throw new Error("useMenuNavigation needs the side menu")
  }

  return navigation
}
