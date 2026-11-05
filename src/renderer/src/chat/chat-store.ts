import { Store } from "@tanstack/react-store"

interface ChatState {
  /** The reply streaming in; absent when no turn runs. */
  reply?: string
  error?: string
}

export const chatStore = new Store<ChatState>({})
