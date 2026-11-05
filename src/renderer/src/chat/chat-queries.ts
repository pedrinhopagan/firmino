import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query"
import type { EngineClient } from "../engine-client"

export const chatQueries = {
  /** Pages from the newest backwards: the first page holds the latest messages. */
  messages: (client: EngineClient) => infiniteQueryOptions({
    queryKey: ["conversation", "messages"],
    queryFn: ({ pageParam }) => client.conversation.messages(pageParam ? { before: pageParam } : {}),
    initialPageParam: 0,
    getNextPageParam: (page) => page.before,
  }),
  providers: (client: EngineClient) => queryOptions({ queryKey: ["providers", "status"], queryFn: () => client.providers.status(), staleTime: Number.POSITIVE_INFINITY }),
  active: (client: EngineClient) => queryOptions({ queryKey: ["providers", "active"], queryFn: () => client.providers.active() }),
}
