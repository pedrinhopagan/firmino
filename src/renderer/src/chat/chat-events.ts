import type { QueryClient } from "@tanstack/react-query"
import type { ConversationEvent, ConversationMessage } from "@src/shared/conversation"
import type { EngineClient } from "../engine-client"
import { chatQueries } from "./chat-queries"
import { chatStore } from "./chat-store"

const reconnectDelayMs = 1_000

/** Subscribes once to the Engine's conversation stream and keeps the message list and the streaming reply current. */
export function subscribeChatEvents({ client, queryClient }: { client: EngineClient; queryClient: QueryClient }) {
  const messagesKey = chatQueries.messages(client).queryKey

  function append(message: ConversationMessage) {
    queryClient.setQueryData(messagesKey, (data) => {
      const [newest, ...older] = data?.pages ?? []

      if (!data || !newest || newest.messages.some((known) => known.id === message.id)) {
        return data
      }

      return { ...data, pages: [{ ...newest, messages: [...newest.messages, message] }, ...older] }
    })
  }

  function handle(event: ConversationEvent) {
    if (event.type === "started") {
      append(event.message)
      chatStore.setState(() => ({ reply: "" }))

      return
    }

    if (event.type === "delta") {
      chatStore.setState((state) => ({ reply: (state.reply ?? "") + event.text }))

      return
    }

    if (event.type === "tool") {
      chatStore.setState((state) => ({ ...state, tool: event.name }))

      return
    }

    if (event.message) {
      append(event.message)
    }

    chatStore.setState(() => (event.error ? { error: event.error } : {}))
  }

  async function listen() {
    while (true) {
      try {
        for await (const event of await client.conversation.events()) {
          handle(event)
        }
      } catch (error) {
        console.error("A conversa com o Engine foi interrompida", error)
      }

      chatStore.setState(() => ({}))
      await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs))
      await queryClient.invalidateQueries({ queryKey: messagesKey })
    }
  }

  void listen()
}
