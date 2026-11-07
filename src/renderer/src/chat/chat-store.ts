import { Store } from "@tanstack/react-store"
import type { WorkEntry } from "@src/shared/conversation"

/** The turn in progress, as far as the Renderer has drawn it. */
interface LiveTurn {
  /** When the message that started it was sent. */
  startedAt: string
  reply: string
  /** Each step of the work, in the order it started. */
  work: WorkEntry[]
}

interface ChatState {
  /** Absent when no turn runs. */
  turn?: LiveTurn
  error?: string
}

export const chatStore = new Store<ChatState>({})
