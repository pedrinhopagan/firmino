import { eventIterator, oc } from "@orpc/contract"
import { z } from "zod"
import { conversationEvent, conversationMessage, providerChoice, providerStatus } from "./conversation"
import { externalObservationSpan } from "./observation"

const healthOutput = z.object({
  status: z.literal("ready"),
  runtime: z.string(),
  startedAt: z.string(),
})

const busy = { TURN_RUNNING: {} }

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
  },
}
