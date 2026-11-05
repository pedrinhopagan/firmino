import { z } from "zod"

const id = z.string().min(1)

export const observationName = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/)
const outcome = z.enum(["ok", "error"])
const level = z.enum(["info", "error"])
const trace = z.strictObject({ traceId: id, spanId: id, parentSpanId: id.optional() })

export const observationAttributes = z.strictObject({
  code: z.string().optional(),
  method: z.string().optional(),
  process: z.string().optional(),
  runtime: z.string().optional(),
  status: z.string().optional(),
  version: z.string().optional(),
})

export const observationContext = z.strictObject({
  appSessionId: id.optional(),
  ...trace.partial().shape,
})

const normalizedObservationError = z.strictObject({
  type: z.string(),
  message: z.string(),
  code: z.string().optional(),
  stack: z.string().optional(),
})

const baseObservation = {
  ...observationContext.shape,
  name: observationName,
  timestamp: z.string(),
  level,
  attributes: observationAttributes.optional(),
  error: normalizedObservationError.optional(),
}

const observation = z.discriminatedUnion("kind", [
  z.strictObject({ ...baseObservation, kind: z.literal("event") }),
  z.strictObject({ ...baseObservation, kind: z.literal("span"), durationMs: z.number(), outcome }),
])

export const externalObservationSpan = z.strictObject({
  ...trace.shape,
  name: observationName,
  timestamp: z.string(),
  durationMs: z.number(),
  outcome,
  attributes: observationAttributes.optional(),
  error: normalizedObservationError.optional(),
})

export type Observation = z.infer<typeof observation>
export type ObservationAttributes = z.infer<typeof observationAttributes>
export type ObservationContext = z.infer<typeof observationContext>
export type NormalizedObservationError = z.infer<typeof normalizedObservationError>
export type ExternalObservationSpan = z.infer<typeof externalObservationSpan>
