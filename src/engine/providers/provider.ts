import { homedir } from "node:os"
import type { TurnOutcome } from "@src/shared/conversation"

export interface TurnResult {
  outcome: TurnOutcome
  error?: string
}

/** A provider's live process. It starts on the first turn and keeps its own session, so later turns remember earlier ones. */
export interface ProviderSession {
  turn(input: { text: string; model?: string }, onDelta: (text: string) => void): Promise<TurnResult>
  interrupt(): Promise<void>
  close(): void
}

export interface ProviderSessionOptions {
  executable: string
  /** The provider's session id saved from an earlier run. */
  resume?: string
  onSession(id: string | undefined): void
}

export const kolegaWorkingDirectory = homedir()

export const kolegaInstructions = "Você é o Kolega, o secretário pessoal do usuário. Responda sempre em português do Brasil, de forma direta e cordial."

export function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
