import { Bars3Icon, CalendarIcon, ChatBubbleLeftRightIcon, ChevronRightIcon, RectangleStackIcon } from "@heroicons/react/16/solid"
import { useStore } from "@tanstack/react-store"
import { type ComponentType, type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { appointmentStore } from "../appointments/appointment-events"
import type { EngineClient } from "../engine-client"
import { IconButton } from "../ui/icon-button"
import { Sheet } from "../ui/sheet"
import { AppointmentPage } from "./appointment-page"
import { type AppointmentScreen, type MenuScreen, MenuNavigationContext, menuRequest } from "./menu-navigation"
import { type SettingsPage, settingsPages } from "./settings"

/** The menu's lists: the root one, and Gerenciamento inside it. Every other screen is a settings page or a Compromisso. */
const lists = {
  menu: { label: "Menu", icon: Bars3Icon, items: ["management", "connections", "providers", "appearance"] },
  management: { label: "Gerenciamento", description: "Memória, compromissos, rotinas e gatilhos", icon: RectangleStackIcon, items: ["memory", "appointments", "routines", "schedules", "triggers"] },
} satisfies Record<string, { label: string; description?: string; icon: ComponentType<{ className?: string }>; items: (SettingsPage | "management")[] }>

interface Crumb {
  label: string
  icon: ComponentType<{ className?: string }>
}

function appointmentId(screen: AppointmentScreen) {
  return screen.slice("appointment:".length)
}

function isAppointment(screen: MenuScreen): screen is AppointmentScreen {
  return screen.startsWith("appointment:")
}

/**
 * The menu button and the full-height menu it opens over the conversation. The menu is a stack of screens:
 * each item shows its list, settings page or Compromisso in place of the current one, and the breadcrumbs go back to any screen before it.
 * Only opening and closing the menu animate; moving between its screens does not.
 */
export function SideMenu({ client }: { client: EngineClient }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const current = useRef<HTMLDivElement>(null)
  /** The screens from the root to the one shown, which is the last. */
  const [trail, setTrail] = useState<MenuScreen[]>(["menu"])
  /** The deepest trail visited from the shown screen, which the mouse's forward button walks back into. */
  const visited = useRef<MenuScreen[]>(["menu"])
  const appointments = useStore(appointmentStore, (state) => state.appointments)

  function openOn(screens: MenuScreen[]) {
    visited.current = screens
    flushSync(() => setTrail(screens))
    dialog.current?.showModal()
  }

  // A request can come before the menu mounts, so it is read once here and then on every change; each is cleared once handled.
  useEffect(() => {
    function handle({ trail: requested }: typeof menuRequest.state) {
      if (!requested) {
        return
      }

      menuRequest.setState(() => ({}))
      openOn(requested)
    }

    handle(menuRequest.state)
    const subscription = menuRequest.subscribe(handle)

    return () => subscription.unsubscribe()
  }, [])

  /**
   * The focus moves only after React has swapped the screen, since the clicked item is gone.
   * Opening a screen other than the one visited next drops the screens the forward button could reach.
   */
  function push(screen: MenuScreen) {
    const next = [...trail, screen]

    if (visited.current[trail.length] !== screen) {
      visited.current = next
    }

    flushSync(() => setTrail(next))
    current.current?.querySelector("button")?.focus()
  }

  /** Going back focuses the item that opened the screen left, marked with `data-screen`. */
  function goTo(level: number) {
    const left = trail[level + 1]
    flushSync(() => setTrail(trail.slice(0, level + 1)))
    const opener = current.current?.querySelector<HTMLElement>(`[data-screen="${left}"]`)
    ;(opener ?? current.current?.querySelector("button"))?.focus()
  }

  /** The mouse's back button (3) goes to the previous screen, or to the conversation from the root; its forward button (4) reopens the screen left. */
  function navigateOnMouseButton(event: MouseEvent) {
    const ahead = visited.current[trail.length]

    if (event.button === 4 && ahead) {
      event.preventDefault()
      push(ahead)
      return
    }

    if (event.button !== 3) {
      return
    }

    event.preventDefault()

    if (trail.length === 1) {
      dialog.current?.close()
      return
    }

    goTo(trail.length - 2)
  }

  function crumb(screen: MenuScreen): Crumb {
    if (isAppointment(screen)) {
      const id = appointmentId(screen)

      return { label: appointments?.find((appointment) => appointment.id === id)?.title ?? "Compromisso", icon: CalendarIcon }
    }

    if (screen === "menu" || screen === "management") {
      return lists[screen]
    }

    return settingsPages[screen]
  }

  function body(screen: MenuScreen) {
    if (screen === "menu" || screen === "management") {
      const { label, items } = lists[screen]

      return (
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2" aria-label={label}>
          {items.map((item) => <MenuItem key={item} screen={item} {...(item === "management" ? lists.management : settingsPages[item])} onClick={() => push(item)} />)}
        </nav>
      )
    }

    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 px-3 pt-4 pb-6">
          {isAppointment(screen) ? <AppointmentPage client={client} id={appointmentId(screen)} /> : <PageOf screen={screen} client={client} />}
        </div>
      </div>
    )
  }

  return (
    <MenuNavigationContext value={{ push, back: () => goTo(trail.length - 2) }}>
      <IconButton className="[-webkit-app-region:no-drag]" label="Menu" tooltipPlacement="bottom" onClick={() => openOn(["menu"])}>
        <Bars3Icon aria-hidden="true" />
      </IconButton>
      <Sheet ref={dialog} label="Menu" side="right">
        <div ref={current} className="flex size-full" onMouseUp={navigateOnMouseButton}>
          {trail.slice(-1).map((screen) => (
            <MenuScreen key={`${trail.length}:${screen}`} crumbs={trail.map(crumb)} onCrumb={goTo} onClose={() => dialog.current?.close()}>
              {body(screen)}
            </MenuScreen>
          ))}
        </div>
      </Sheet>
    </MenuNavigationContext>
  )
}

function PageOf({ screen, client }: { screen: SettingsPage; client: EngineClient }) {
  const { Page } = settingsPages[screen]

  return <Page client={client} />
}

/** One screen: its breadcrumbs, from the conversation to itself, over its content. Every crumb before the last goes back to its screen. */
function MenuScreen({ crumbs, onCrumb, onClose, children }: { crumbs: Crumb[]; onCrumb: (level: number) => void; onClose: () => void; children: ReactNode }) {
  const current = crumbs.at(-1)

  return (
    <section className="flex min-h-0 w-full shrink-0 flex-col" aria-label={current?.label}>
      <nav className="flex h-12 shrink-0 items-center border-b px-2" aria-label="Caminho">
        <ol className="m-0 flex min-w-0 flex-1 list-none items-center gap-0.5 p-0">
          <li className="flex shrink-0">
            <IconButton label="Voltar à conversa" tooltipPlacement="bottom" onClick={onClose}>
              <ChatBubbleLeftRightIcon aria-hidden="true" />
            </IconButton>
          </li>
          {crumbs.slice(0, -1).map(({ label, icon: Icon }, level) => (
            <li key={label} className="flex shrink-0 items-center gap-0.5">
              <ChevronRightIcon className="size-3 text-muted-foreground" aria-hidden="true" />
              <IconButton label={label} tooltipPlacement="bottom" onClick={() => onCrumb(level)}>
                <Icon aria-hidden="true" />
              </IconButton>
            </li>
          ))}
          <li className="flex min-w-0 items-center gap-0.5">
            <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate px-1 text-sm font-medium text-foreground" aria-current="page" title={current?.label}>{current?.label}</span>
          </li>
        </ol>
      </nav>
      {children}
    </section>
  )
}

function MenuItem({ screen, label, description, icon: Icon, onClick }: { screen: MenuScreen; label: string; description: string; icon: ComponentType<{ className?: string }>; onClick: () => void }) {
  return (
    <button type="button" data-screen={screen} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={onClick}>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="truncate text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}
