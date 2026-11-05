import { eventIterator, oc } from "@orpc/contract"
import { z } from "zod"
import { conversationEvent, conversationMessage, favoriteModel, newProviderAccount, providerAccount, providerChoice, providerLoginEvent, providerStatus } from "./conversation"
import { googleStatus } from "./google"
import { externalObservationSpan } from "./observation"
import { whatsappStatus } from "./whatsapp"

const healthOutput = z.object({
  status: z.literal("ready"),
  runtime: z.string(),
  startedAt: z.string(),
})

const busy = { TURN_RUNNING: {} }
/** A Zen container id, 0 for the default identity. */
const zenIdentity = z.int().min(0)

export const engineContract = {
  health: oc.output(healthOutput).route({ method: "GET", path: "/health" }),
  observations: {
    rendererSpan: oc.input(externalObservationSpan).route({ method: "POST", path: "/observations/renderer-span" }),
  },
  conversation: {
    messages: oc.input(z.object({ before: z.int().optional() })).output(z.object({ messages: z.array(conversationMessage), before: z.int().optional() })).route({ method: "GET", path: "/conversation/messages" }),
    send: oc.errors(busy).input(z.object({ text: z.string().trim().min(1) })).output(conversationMessage).route({ method: "POST", path: "/conversation/messages" }),
    events: oc.output(eventIterator(conversationEvent)).route({ method: "GET", path: "/conversation/events" }),
    interrupt: oc.route({ method: "POST", path: "/conversation/interrupt" }),
  },
  providers: {
    status: oc.output(z.array(providerStatus)).route({ method: "GET", path: "/providers/status" }),
    active: oc.output(providerChoice).route({ method: "GET", path: "/providers/active" }),
    choose: oc.errors(busy).input(providerChoice).output(providerChoice).route({ method: "POST", path: "/providers/active" }),
    add: oc.input(newProviderAccount).output(providerAccount).route({ method: "POST", path: "/providers/accounts" }),
    update: oc.input(providerAccount.pick({ id: true, name: true, enabled: true })).output(providerAccount).route({ method: "PATCH", path: "/providers/accounts" }),
    remove: oc.input(z.object({ id: z.string() })).route({ method: "DELETE", path: "/providers/accounts" }),
    /** Adds the Codex and Claude accounts T3 Code uses, and updates the ones Kolega already has. */
    importT3: oc.output(z.array(providerAccount)).route({ method: "POST", path: "/providers/accounts/import-t3" }),
    /** Opens the provider's sign-in page; the stream ends when the sign-in finishes, and aborting it cancels the sign-in. */
    login: oc.input(z.object({ id: z.string() })).output(eventIterator(providerLoginEvent)).route({ method: "POST", path: "/providers/login" }),
    /** The code Claude's sign-in page shows, for the sign-in in progress. */
    loginCode: oc.input(z.object({ id: z.string(), code: z.string().trim().min(1) })).route({ method: "POST", path: "/providers/login/code" }),
    /** The favorite models, in the order the user starred them. */
    favorites: oc.output(z.array(favoriteModel)).route({ method: "GET", path: "/providers/favorites" }),
    toggleFavorite: oc.input(favoriteModel).output(z.array(favoriteModel)).route({ method: "POST", path: "/providers/favorites" }),
  },
  zen: {
    /** The Zen account the browser imports; absent until the user chooses one. */
    identity: oc.output(z.object({ identity: zenIdentity.optional() })).route({ method: "GET", path: "/zen/identity" }),
    choose: oc.input(z.object({ identity: zenIdentity })).route({ method: "POST", path: "/zen/identity" }),
  },
  whatsapp: {
    /** The current status first, then every change. */
    events: oc.output(eventIterator(whatsappStatus)).route({ method: "GET", path: "/whatsapp/events" }),
    link: oc.output(whatsappStatus).route({ method: "POST", path: "/whatsapp/link" }),
    unlink: oc.route({ method: "POST", path: "/whatsapp/unlink" }),
  },
  google: {
    /** The current status first, then every change. */
    events: oc.output(eventIterator(googleStatus)).route({ method: "GET", path: "/google/events" }),
    connect: oc.output(googleStatus).route({ method: "POST", path: "/google/connect" }),
    /** Cancels a consent in progress, or revokes the connection. */
    disconnect: oc.route({ method: "POST", path: "/google/disconnect" }),
  },
}
