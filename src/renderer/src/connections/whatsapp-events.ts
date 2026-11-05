import { Store } from "@tanstack/react-store"
import type { WhatsappStatus } from "@src/shared/whatsapp"
import type { EngineClient } from "../engine-client"

const reconnectDelayMs = 1_000

/** The WhatsApp status the Engine last sent; absent until the stream answers. */
export const whatsappStore = new Store<{ status?: WhatsappStatus }>({})

/** Subscribes once to the Engine's WhatsApp status stream, which starts with the current status. */
export function subscribeWhatsappEvents(client: EngineClient) {
  async function listen() {
    while (true) {
      try {
        for await (const status of await client.whatsapp.events()) {
          whatsappStore.setState(() => ({ status }))
        }
      } catch (error) {
        console.error("O status do WhatsApp foi interrompido", error)
      }

      await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs))
    }
  }

  void listen()
}
