import { homedir } from "node:os"
import type { TurnOutcome } from "@src/shared/conversation"
import type { KolegaMcpConnection } from "../kolega-mcp"

export interface TurnResult {
  outcome: TurnOutcome
  error?: string
}

/** What a turn reports while it runs: reply text as it streams, and each tool the agent starts using. */
export interface TurnListener {
  delta(text: string): void
  tool(name: string): void
}

/** A provider's live process. It starts on the first turn and keeps its own session, so later turns remember earlier ones. */
export interface ProviderSession {
  turn(input: { text: string; model?: string }, listener: TurnListener): Promise<TurnResult>
  interrupt(): Promise<void>
  close(): void
}

export interface ProviderSessionOptions {
  executable: string
  /** The provider's session id saved from an earlier run. */
  resume?: string
  onSession(id: string | undefined): void
  /** Kolega's own MCP server, given to the provider on every session it starts or resumes. */
  mcp: KolegaMcpConnection
}

export const kolegaWorkingDirectory = homedir()

export const kolegaInstructions = [
  "Você é o Kolega, o secretário pessoal do usuário. Responda sempre em português do Brasil, de forma direta e cordial.",
  "Cada mensagem começa com a data e a hora local do usuário. Use essa hora para entender pedidos como \"daqui a 2 minutos\" ou \"amanhã às 9h\" e não a repita na resposta.",
  "Para lembretes e tarefas agendadas, use as ferramentas de Rotina do servidor MCP kolega: save_routine cria ou altera, list_routines lista e remove_routine remove. Não use cron, at, sleep nem outros agendadores do sistema.",
  "Uma mensagem que começa com \"Rotina\" e o nome dela foi disparada por uma Rotina, não escrita pelo usuário. Faça o que ela pede e fale com o usuário como se fosse um lembrete seu.",
].join("\n\n")

export function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
