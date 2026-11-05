import { oc } from "@orpc/contract"
import { z } from "zod"
import { externalObservationSpan } from "./observation"

const healthOutput = z.object({
  status: z.literal("ready"),
  runtime: z.string(),
  startedAt: z.string(),
})

export type EngineHealth = z.infer<typeof healthOutput>

export const engineContract = {
  health: oc.output(healthOutput).route({ method: "GET", path: "/health" }),
  observations: {
    rendererSpan: oc.input(externalObservationSpan).route({ method: "POST", path: "/observations/renderer-span" }),
  },
}
