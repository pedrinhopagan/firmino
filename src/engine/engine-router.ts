import { implement, ORPCError } from "@orpc/server"
import { engineContract } from "@src/shared/engine-contract"
import type { ObservationReceiver, Observability } from "./observability"

export interface EngineContext { traceId?: string; spanId?: string }

/** Turns any failure into an error the Renderer can show, keeping errors that already carry an RPC code. */
function surfaced(error: unknown) {
  if (error instanceof ORPCError) {
    return error
  }

  return new ORPCError("BAD_REQUEST", { message: error instanceof Error ? error.message : "Unknown error", cause: error })
}

export function createEngineRouter({ startedAt, observability, receiver }: { startedAt: string; observability: Observability; receiver: ObservationReceiver }) {
  const operations = implement(engineContract).$context<EngineContext>().use(async ({ next, context, path }) => {
    try {
      const operation = path.join(".").toLowerCase()

      if (operation.startsWith("observations.")) {
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
  })
}
