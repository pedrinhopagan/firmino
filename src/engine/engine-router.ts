import { implement, ORPCError } from "@orpc/server"
import { engineContract } from "@src/shared/engine-contract"
import type { Appointments } from "./appointments"
import type { Browser } from "./browser"
import type { Conversation } from "./conversation"
import type { KolegaDatabase } from "./database"
import type { Discord } from "./discord"
import type { Memory } from "./memory"
import type { ObservationReceiver, Observability } from "./observability"
import type { Google } from "./google/google"
import { imagePath } from "./providers/provider"
import type { ProviderAccounts } from "./providers/provider-accounts"
import type { Routines } from "./routines"
import type { Triggers } from "./triggers"
import type { Whatsapp } from "./whatsapp/whatsapp"

export interface EngineContext { traceId?: string; spanId?: string }

/** Turns any failure into an error the Renderer can show, keeping errors that already carry an RPC code. */
function surfaced(error: unknown) {
  if (error instanceof ORPCError) {
    return error
  }

  return new ORPCError("BAD_REQUEST", { message: error instanceof Error ? error.message : "Unknown error", cause: error })
}

const imageBytesLimit = 25 * 1024 * 1024

/** Reads a file only when its name says it is an image, so the chat cannot show other files by path. */
async function localImage(path: string) {
  const file = Bun.file(path)

  if (!imagePath(path) || !(await file.exists())) {
    throw new ORPCError("NOT_FOUND", { message: `Imagem não encontrada: ${path}` })
  }

  if (file.size > imageBytesLimit) {
    throw new ORPCError("PAYLOAD_TOO_LARGE", { message: "A imagem passa de 25 MB." })
  }

  return file
}

async function* surfacedStream<T>(stream: AsyncIterable<T>) {
  try {
    yield* stream
  } catch (error) {
    throw surfaced(error)
  }
}

export function createEngineRouter({ startedAt, observability, receiver, database, accounts, conversation, memory, routines, appointments, triggers, browser, whatsapp, google, discord }: { startedAt: string; observability: Observability; receiver: ObservationReceiver; database: KolegaDatabase; accounts: ProviderAccounts; conversation: Conversation; memory: Pick<Memory, "clear" | "forget">; routines: Pick<Routines, "save" | "remove">; appointments: Pick<Appointments, "events" | "complete" | "dismiss" | "remove">; triggers: Pick<Triggers, "save" | "remove">; browser: Pick<Browser, "interrupt">; whatsapp: Whatsapp; google: Google; discord: Discord }) {
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
      answer: operations.conversation.answer.handler(({ input }) => conversation.answer(input.id, input.answers)),
      image: operations.conversation.image.handler(({ input }) => localImage(input.path)),
    },
    providers: {
      status: operations.providers.status.handler(() => accounts.status()),
      active: operations.providers.active.handler(() => conversation.active()),
      choose: operations.providers.choose.handler(({ input }) => conversation.choose(input)),
      add: operations.providers.add.handler(({ input }) => accounts.add(input)),
      update: operations.providers.update.handler(({ input }) => accounts.update(input)),
      remove: operations.providers.remove.handler(({ input }) => accounts.remove(input.id)),
      importT3: operations.providers.importT3.handler(() => accounts.importT3()),
      login: operations.providers.login.handler(({ input, signal }) => surfacedStream(accounts.login(input.id, signal))),
      loginCode: operations.providers.loginCode.handler(({ input }) => accounts.loginCode(input.id, input.code)),
      favorites: operations.providers.favorites.handler(() => conversation.favorites()),
      toggleFavorite: operations.providers.toggleFavorite.handler(({ input }) => conversation.toggleFavorite(input)),
    },
    memory: {
      list: operations.memory.list.handler(() => database.memories.all()),
      forget: operations.memory.forget.handler(({ input }) => {
        memory.forget([input.id])
      }),
      clear: operations.memory.clear.handler(() => memory.clear()),
    },
    routines: {
      list: operations.routines.list.handler(() => database.routines.list()),
      setEnabled: operations.routines.setEnabled.handler(({ input }) => routines.save(input)),
      remove: operations.routines.remove.handler(({ input }) => {
        routines.remove(input.id)
      }),
    },
    appointments: {
      events: operations.appointments.events.handler(({ signal }) => surfacedStream(appointments.events(signal))),
      complete: operations.appointments.complete.handler(({ input }) => {
        appointments.complete(input.id)
      }),
      dismiss: operations.appointments.dismiss.handler(({ input }) => appointments.dismiss(input.id)),
      remove: operations.appointments.remove.handler(({ input }) => {
        appointments.remove(input.id)
      }),
    },
    triggers: {
      list: operations.triggers.list.handler(() => database.triggers.list()),
      setEnabled: operations.triggers.setEnabled.handler(({ input }) => triggers.save(input)),
      remove: operations.triggers.remove.handler(({ input }) => {
        triggers.remove(input.id)
      }),
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
    discord: {
      status: operations.discord.status.handler(() => discord.status()),
      connect: operations.discord.connect.handler(({ input }) => discord.connect(input.token)),
      disconnect: operations.discord.disconnect.handler(() => discord.disconnect()),
    },
  })
}
