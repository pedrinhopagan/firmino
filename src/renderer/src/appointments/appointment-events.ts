import { Store } from "@tanstack/react-store"
import type { Appointment } from "@src/shared/appointment"
import type { EngineClient } from "../engine-client"

const reconnectDelayMs = 1_000

/** The Compromissos the Engine last sent; absent until the stream answers. */
export const appointmentStore = new Store<{ appointments?: Appointment[] }>({})

/** Subscribes once to the Engine's Compromissos, which arrive whole on every change. */
export function subscribeAppointmentEvents(client: EngineClient) {
  async function listen() {
    while (true) {
      try {
        for await (const appointments of await client.appointments.events()) {
          appointmentStore.setState(() => ({ appointments }))
        }
      } catch (error) {
        console.error("Os compromissos foram interrompidos", error)
      }

      await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs))
    }
  }

  void listen()
}
