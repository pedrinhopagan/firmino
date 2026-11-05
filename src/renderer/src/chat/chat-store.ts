import { Store } from "@tanstack/react-store"

interface ChatState {
  /** The reply streaming in; absent when no turn runs. */
  reply?: string
  /** The tool the agent started using last in this turn; cleared when the reply streams on. */
  tool?: string
  error?: string
}

export const chatStore = new Store<ChatState>({})
