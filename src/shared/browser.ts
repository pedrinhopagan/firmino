import { z } from "zod"

const target = z.string().regex(/^@e[0-9]+$/)

export const browserKeys = ["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "Backspace"] as const

/** What the agent asks of the browser page, as the Engine validated it and Main executes it. */
export const browserAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("navigate"), url: z.url({ protocol: /^https?$/ }) }),
  z.object({ action: z.literal("snapshot") }),
  z.object({ action: z.literal("take_control") }),
  z.object({ action: z.literal("click"), target }),
  z.object({ action: z.literal("fill"), target, text: z.string().max(20_000) }),
  z.object({ action: z.literal("press"), key: z.enum(browserKeys) }),
  z.object({ action: z.literal("scroll"), direction: z.enum(["up", "down"]) }),
  z.object({ action: z.literal("handoff"), reason: z.string().min(1).max(500) }),
  z.object({ action: z.literal("close") }),
])

/** Engine to Main: run one action on the page, or capture the Kolega window. A later request supersedes one still running. */
export const browserRequest = z.object({ type: z.literal("browser-request"), id: z.uuid(), input: z.union([browserAction, z.object({ action: z.literal("screenshot") })]) })

/** Engine to Main: the tool call that sent this request ended before the reply. */
export const browserCancel = z.object({ type: z.literal("browser-cancel"), id: z.uuid() })

/** Main to Engine: the page text for the agent, or why the action failed. */
export const browserReply = z.object({ type: z.literal("browser-reply"), id: z.uuid(), result: z.string(), error: z.boolean() })

/** Where the Renderer drew the page's slot, in window pixels. */
export const browserBounds = z.object({ x: z.int().min(0), y: z.int().min(0), width: z.int().min(1), height: z.int().min(1) })

/** What the Renderer shows about the one page: null while no page is open. */
export interface BrowserState {
  url: string
  title: string
  /** The user's control is also what shows the page in the window. */
  control: "agent" | "user"
  /** The agent's handoff reason, shown above the page while the user has control. */
  reason: string | null
}

/** One Zen account the browser can take cookies from: the default identity, id 0, or a container. */
export interface ZenIdentity {
  id: number
  name: string
  /** Live cookies, counted; their values never leave Main. */
  cookies: number
}

export type BrowserAction = z.infer<typeof browserAction>
export type BrowserRequest = z.infer<typeof browserRequest>
export type BrowserReply = z.infer<typeof browserReply>
export type BrowserBounds = z.infer<typeof browserBounds>
