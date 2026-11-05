import { implement, ORPCError } from "@orpc/server"
import { engineContract } from "@src/shared/engine-contract"
import type { Browser } from "./browser"
import type { Conversation } from "./conversation"
import type { KolegaDatabase } from "./database"
import type { ObservationReceiver, Observability } from "./observability"
import type { Google } from "./google/google"
import type { Whatsapp } from "./whatsapp/whatsapp"

export interface EngineContext { traceId?: string; spanId?: string }

/** Turns any failure into an error the Renderer can show, keeping errors that already carry an RPC code. */
function surfaced(error: unknown) {
  if (error instanceof ORPCError) {
    return error
  }

  return new ORPCError("BAD_REQUEST", { message: error instanceof Error ? error.message : "Unknown error", cause: error })
}

async function* surfacedStream<T>(stream: AsyncIterable<T>) {
  try {
    yield* stream
  } catch (error) {
    throw surfaced(error)
  }
}

export function createEngineRouter({ startedAt, observability, receiver, database, conversation, browser, whatsapp, google }: { startedAt: string; observability: Observability; receiver: ObservationReceiver; database: KolegaDatabase; conversation: Conversation; browser: Pick<Browser, "interrupt">; whatsapp: Whatsapp; google: Google }) {
  const operations = implement(engineContract).$context<EngineContext>().use(async ({ next, context, path }) => {
    try {
      const operation = path.join(".").toLowerCase()

      if (operation.startsWith("observations.") || operation.endsWith(".events")) {
        return await next()
      }

      return await observability.span({ name: `orpc.${operation}`, context }, () => next())
    } catch (error) {
      throw surfaced(error)
    }
  })

  return operations.router({
    health: operations.health.handler(() => ({ status: "ready", runtime: `Bun ${Bun.version}`, startedAt })),
    observations: {
      rendererSpan: operations.observations.rendererSpan.handler(({ input }) => receiver.span(input)),
    },
    conversation: {
      messages: operations.conversation.messages.handler(({ input }) => database.messages.page(input.before)),
      send: operations.conversation.send.handler(({ input }) => conversation.send(input.text)),
      events: operations.conversation.events.handler(({ signal }) => surfacedStream(conversation.events(signal))),
      interrupt: operations.conversation.interrupt.handler(async () => {
        browser.interrupt()
        await conversation.interrupt()
      }),
    },
    providers: {
      status: operations.providers.status.handler(() => conversation.status()),
      active: operations.providers.active.handler(() => conversation.active()),
      choose: operations.providers.choose.handler(({ input }) => conversation.choose(input)),
    },
    zen: {
      identity: operations.zen.identity.handler(() => {
        const stored = database.state.get("zen.identity")

        if (stored === undefined) {
          return {}
        }

        return { identity: Number(stored) }
      }),
      choose: operations.zen.choose.handler(({ input }) => database.state.set("zen.identity", String(input.identity))),
    },
    whatsapp: {
      events: operations.whatsapp.events.handler(({ signal }) => surfacedStream(whatsapp.events(signal))),
      link: operations.whatsapp.link.handler(() => whatsapp.link()),
      unlink: operations.whatsapp.unlink.handler(() => whatsapp.unlink()),
    },
    google: {
      events: operations.google.events.handler(({ signal }) => surfacedStream(google.events(signal))),
      connect: operations.google.connect.handler(() => google.connect()),
      disconnect: operations.google.disconnect.handler(() => google.disconnect()),
    },
  })
}
