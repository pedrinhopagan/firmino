import { Store } from "@tanstack/react-store"
import type { GoogleStatus } from "@src/shared/google"
import type { EngineClient } from "../engine-client"

const reconnectDelayMs = 1_000

/** The Google status the Engine last sent; absent until the stream answers. */
export const googleStore = new Store<{ status?: GoogleStatus }>({})

/** Subscribes once to the Engine's Google status stream, which starts with the current status. */
export function subscribeGoogleEvents(client: EngineClient) {
  async function listen() {
    while (true) {
      try {
        for await (const status of await client.google.events()) {
          googleStore.setState(() => ({ status }))
        }
      } catch (error) {
        console.error("O status do Google foi interrompido", error)
      }

      await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs))
    }
  }

  void listen()
}
