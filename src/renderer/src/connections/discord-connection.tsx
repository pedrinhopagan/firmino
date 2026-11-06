import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useState } from "react"
import type { EngineClient } from "../engine-client"
import { Button } from "../ui/button"
import { SettingsRow } from "../ui/settings-section"

const queryKey = ["discord", "status"]
const noteClassName = "m-0 text-xs text-muted-foreground"
const errorClassName = "m-0 px-3 py-2.5 text-xs text-destructive-foreground"
const inputClassName = "h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

/** The user's own Discord account, connected with the token the user pastes, so the agent can send as the user. */
export function DiscordConnection({ client }: { client: EngineClient }) {
  const queryClient = useQueryClient()
  // A tool call ends the connection when Discord rejects the token; React Query reads the status again when the screen opens or the window regains focus.
  const status = useQuery({ queryKey, queryFn: () => client.discord.status() })
  const [token, setToken] = useState("")
  const connect = useMutation({
    mutationFn: () => client.discord.connect({ token }),
    onSuccess: (next) => {
      setToken("")
      queryClient.setQueryData(queryKey, next)
    },
  })
  const disconnect = useMutation({
    mutationFn: () => client.discord.disconnect(),
    onSuccess: () => queryClient.setQueryData(queryKey, { state: "disconnected" }),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    connect.mutate()
  }

  if (!status.data) {
    return null
  }

  const failure = status.data.state === "disconnected" ? status.data.error : undefined
  const error = (connect.error ?? disconnect.error)?.message ?? failure

  return (
    <div className="flex flex-col">
      <SettingsRow title="Discord" description={<span role="status">{status.data.state === "connected" ? `Conectado · ${status.data.account}` : "Não conectado"}</span>}>
        {status.data.state === "connected" && <Button variant="danger" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>Desconectar</Button>}
      </SettingsRow>
      {error && <p className={errorClassName} role="alert">{error}</p>}
      {status.data.state === "disconnected" && (
        <form className="flex flex-col gap-2 px-3 py-2.5" onSubmit={submit}>
          <div className="flex items-center gap-2">
            <input className={inputClassName} type="password" autoComplete="off" value={token} placeholder="Token da sua conta do Discord" aria-label="Token do Discord" onChange={(event) => setToken(event.target.value)} />
            <Button type="submit" variant="secondary" disabled={!token.trim() || connect.isPending}>Conectar</Button>
          </div>
          <p className={noteClassName}>Abra o Discord no navegador e aperte F12. Na aba Rede, recarregue a página e copie o cabeçalho Authorization de uma requisição para /api.</p>
          <p className={noteClassName}>O Kolega envia mensagens como você. O Discord não autoriza automação de contas pessoais. A conta pode ser bloqueada.</p>
        </form>
      )}
    </div>
  )
}
