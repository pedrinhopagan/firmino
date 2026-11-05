import { hashKey, type QueryClient } from "@tanstack/react-query"
import type { ConversationEvent, ConversationMessage } from "@src/shared/conversation"
import type { EngineClient } from "../engine-client"
import { chatQueries } from "./chat-queries"
import { chatStore } from "./chat-store"

const reconnectDelayMs = 1_000
const newestPageLimit = 100
const trimmedPageSize = 50
const minFlushMs = 100
const flushCharsPerMs = 100

/** Subscribes once to the Engine's conversation stream and keeps the message list and the streaming reply current. */
export function subscribeChatEvents({ client, queryClient }: { client: EngineClient; queryClient: QueryClient }) {
  const messagesKey = chatQueries.messages(client).queryKey

  const messagesHash = hashKey(messagesKey)
  /** Messages appended while a page load was in flight: that load resolves with the pages it read before them. */
  const pending: ConversationMessage[] = []

  /** Adds messages to the newest page. Past `newestPageLimit` it keeps the latest `trimmedPageSize` and drops the older pages, which "Mostrar anteriores" loads again. */
  function append(messages: ConversationMessage[]) {
    queryClient.setQueryData(messagesKey, (data) => {
      const [newest, ...older] = data?.pages ?? []

      if (!data || !newest) {
        return data
      }

      const known = new Set(newest.messages.map((message) => message.id))
      const merged = [...newest.messages, ...messages.filter((message) => !known.has(message.id))]

      if (merged.length === newest.messages.length) {
        return data
      }

      if (merged.length <= newestPageLimit) {
        return { ...data, pages: [{ ...newest, messages: merged }, ...older] }
      }

      const kept = merged.slice(-trimmedPageSize)

      return { pages: [{ messages: kept, before: kept[0]?.id }], pageParams: data.pageParams.slice(0, 1) }
    })

    if (queryClient.isFetching({ queryKey: messagesKey }) > 0) {
      pending.push(...messages)
    }
  }

  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.query.queryHash !== messagesHash || pending.length === 0) {
      return
    }

    // A failed load left the appended messages in place; replaying them could only reorder or trim newer ones away.
    if (event.action.type === "error") {
      pending.length = 0

      return
    }

    if (event.action.type === "success" && !event.action.manual) {
      append(pending.splice(0))
    }
  })

  let unflushed = ""
  let flushTimer: ReturnType<typeof setTimeout> | undefined

  /** Moves buffered reply text into the store, so the reply's Markdown is parsed once per flush instead of once per delta. */
  function flush() {
    clearTimeout(flushTimer)
    flushTimer = undefined

    if (!unflushed) {
      return
    }

    const text = unflushed
    unflushed = ""
    chatStore.setState((state) => ({ reply: (state.reply ?? "") + text }))
  }

  function handle(event: ConversationEvent) {
    if (event.type === "delta") {
      unflushed += event.text
      // ponytail: the whole reply is parsed again on each flush; the interval grows with its length to keep that near a tenth of the main thread.
      flushTimer ??= setTimeout(flush, Math.max(minFlushMs, (chatStore.state.reply?.length ?? 0) / flushCharsPerMs))

      return
    }

    flush()

    if (event.type === "started") {
      append([event.message])
      chatStore.setState(() => ({ reply: "" }))

      return
    }

    if (event.type === "tool") {
      chatStore.setState((state) => ({ ...state, tool: event.name }))

      return
    }

    if (event.message) {
      append([event.message])
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

      unflushed = ""
      flush()
      chatStore.setState(() => ({}))
      await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs))
      await queryClient.invalidateQueries({ queryKey: messagesKey })
    }
  }

  void listen()
}
