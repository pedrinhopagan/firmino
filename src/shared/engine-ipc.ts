import { z } from "zod"
import { externalObservationSpan, observationAttributes, observationContext, observationName } from "./observation"

/** The first IPC message the Engine sends to Main, once its RPC server listens. */
export const engineReadyMessage = z.object({
  type: z.literal("ready"),
  port: z.int().min(1),
})

const forwardedObservationEvent = z.strictObject({
  type: z.literal("observation"),
  name: observationName,
  attributes: observationAttributes.optional(),
  context: observationContext.optional(),
})

const forwardedObservationSpan = z.strictObject({
  type: z.literal("span"),
  span: externalObservationSpan,
})

/** Observations Main records in the Engine log, which is the only log of the app. */
export const forwardedObservation = z.discriminatedUnion("type", [forwardedObservationEvent, forwardedObservationSpan])

export interface EngineConnection {
  url: string
  token: string
}

export type ForwardedObservationEvent = z.infer<typeof forwardedObservationEvent>
export type ForwardedObservation = z.infer<typeof forwardedObservation>
