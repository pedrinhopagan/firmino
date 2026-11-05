import { createHash } from "node:crypto"
import { z } from "zod"
import { parse } from "@src/shared/parse"

const closeDelayMs = 50

/** One consent for both tools: Gmail as Mimo asks for it, and the Calendar scope that lists and edits events only on calendars the user owns. */
const googleScopes = ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/calendar.events.owned"]

const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth"
const tokenEndpoint = "https://oauth2.googleapis.com/token"
const revokeEndpoint = "https://oauth2.googleapis.com/revoke"

export interface GoogleClient { id: string; secret?: string }

const tokenResponse = z.looseObject({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional(), expires_in: z.number(), scope: z.string().optional() }).transform((token) => ({
  accessToken: token.access_token,
  refreshToken: token.refresh_token,
  expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
  scopes: token.scope?.split(" ") ?? [],
}))
const tokenFailure = z.looseObject({ error: z.string().optional(), error_description: z.string().optional() })
const credentialsSchema = z.strictObject({ accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresAt: z.string().min(1) })

export type GoogleCredentials = z.infer<typeof credentialsSchema>

/** Google no longer accepts the refresh token: the user revoked access or the grant expired, so only a new consent helps. */
export class GoogleGrantError extends Error {}

/** The user left a permission unticked on Google's consent page; its message is shown in Conexões as is. */
export class GoogleConsentError extends Error {}

const pages = {
  connected: { title: "Google conectado", detail: "Pode fechar esta aba e voltar para o Kolega.", tone: "#4ade80" },
  denied: { title: "O Google não permitiu a conexão", detail: "Pode fechar esta aba e tentar de novo no Kolega.", tone: "#f87171" },
  failed: { title: "O Kolega não conseguiu concluir a conexão", detail: "Pode fechar esta aba e tentar de novo no Kolega.", tone: "#f87171" },
  partial: { title: "Faltou uma permissão", detail: "O Kolega precisa do Gmail e do Google Agenda. Volte ao Kolega e conecte de novo, marcando as duas.", tone: "#f87171" },
  wrongState: { title: "Este link não é o que o Kolega está esperando", detail: "Volte ao Kolega e conecte o Google de novo.", tone: "#f87171" },
}

function page(content: (typeof pages)[keyof typeof pages], status: number) {
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${content.title} · Kolega</title>
<style>
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0b0b; color: #f5f5f5; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 26rem; margin: 1.5rem; padding: 2rem; background: #161616; border: 1px solid #303030; border-radius: 1.5rem; }
span { display: block; width: 0.625rem; height: 0.625rem; margin-bottom: 1rem; border-radius: 999px; background: ${content.tone}; }
h1 { margin: 0 0 0.5rem; font-size: 1.25rem; font-weight: 600; }
p { margin: 0; color: #b8b8b8; }
</style>
</head>
<body>
<main>
<span></span>
<h1>${content.title}</h1>
<p>${content.detail}</p>
</main>
</body>
</html>
`

  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } })
}

export function parseCredentials(stored: string) {
  return parse(credentialsSchema, JSON.parse(stored))
}

function challenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url")
}

async function exchange(client: GoogleClient, body: Record<string, string>, previousRefreshToken?: string) {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.id, ...(client.secret ? { client_secret: client.secret } : {}), ...body }),
  })
  const payload: unknown = await response.json().catch(() => ({}))

  if (!response.ok) {
    const failure = parse(tokenFailure, payload)
    const reason = failure.error_description ?? failure.error ?? `HTTP ${response.status}`

    if (failure.error === "invalid_grant") {
      throw new GoogleGrantError(reason)
    }

    throw new Error(`Google refused the token request: ${reason}`)
  }

  const { scopes, ...token } = parse(tokenResponse, payload)
  const refreshToken = token.refreshToken ?? previousRefreshToken

  if (!refreshToken) {
    throw new Error("Google did not return a refresh token")
  }

  return { credentials: { ...token, refreshToken }, scopes }
}

export async function refreshCredentials(client: GoogleClient, credentials: GoogleCredentials) {
  const refreshed = await exchange(client, { grant_type: "refresh_token", refresh_token: credentials.refreshToken }, credentials.refreshToken)

  return refreshed.credentials
}

/** Revokes the grant on Google's side; revoking the refresh token also ends every access token issued from it. */
export async function revokeCredentials(credentials: GoogleCredentials) {
  const response = await fetch(revokeEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: credentials.refreshToken }),
  })

  if (!response.ok) {
    throw new Error(`Google refused to revoke the token: HTTP ${response.status}`)
  }
}

/**
 * Starts the loopback flow: a one-shot server on a random port receives Google's redirect, and PKCE binds the code to this attempt.
 * `credentials` settles once the user consents, denies or the attempt is cancelled.
 */
export function startAuthorization(client: GoogleClient) {
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
  const state = crypto.randomUUID()
  const settle = Promise.withResolvers<GoogleCredentials>()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)

      if (url.pathname !== "/callback") {
        return new Response("Not found", { status: 404 })
      }

      if (url.searchParams.get("state") !== state) {
        return page(pages.wrongState, 400)
      }

      const code = url.searchParams.get("code")

      if (!code) {
        return finish({ error: new Error(url.searchParams.get("error") ?? "Google did not return a code") }, page(pages.denied, 400))
      }

      try {
        const exchanged = await exchange(client, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri })

        // Google lets the user untick a permission and still grants the rest, so a missing scope refuses the connection and gives the rest back.
        if (!googleScopes.every((scope) => exchanged.scopes.includes(scope))) {
          await revokeCredentials(exchanged.credentials).catch(() => {})

          return finish({ error: new GoogleConsentError("Faltou permitir o Gmail ou o Google Agenda. Conecte de novo e marque as duas permissões.") }, page(pages.partial, 400))
        }

        return finish({ credentials: exchanged.credentials }, page(pages.connected, 200))
      } catch (error) {
        return finish({ error: error instanceof Error ? error : new Error("Token exchange failed") }, page(pages.failed, 500))
      }
    },
  })

  function finish(outcome: { credentials: GoogleCredentials } | { error: Error }, response: Response) {
    setTimeout(() => {
      void server.stop(true)

      if ("error" in outcome) {
        settle.reject(outcome.error)

        return
      }

      settle.resolve(outcome.credentials)
    }, closeDelayMs)

    return response
  }

  const redirectUri = `http://127.0.0.1:${server.port}/callback`
  const authorizationUrl = new URL(authorizationEndpoint)
  authorizationUrl.search = new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: googleScopes.join(" "),
    code_challenge: challenge(verifier),
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  }).toString()

  return {
    authorizationUrl: authorizationUrl.toString(),
    credentials: settle.promise,
    cancel: () => {
      void server.stop(true)
      settle.reject(new Error("Connection cancelled"))
    },
  }
}
