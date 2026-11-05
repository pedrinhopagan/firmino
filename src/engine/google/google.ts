import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { EventPublisher } from "@orpc/server"
import { z } from "zod"
import type { GoogleStatus } from "@src/shared/google"
import { parse } from "@src/shared/parse"
import type { KolegaDatabase } from "../database"
import type { Observability } from "../observability"
import type { Triggers } from "../triggers"
import { registerCalendarTools } from "./calendar"
import { gmailApi, MailWatch, registerGmailTools } from "./gmail"
import { type GoogleClient, GoogleConsentError, type GoogleCredentials, GoogleGrantError, parseCredentials, refreshCredentials, revokeCredentials, startAuthorization } from "./google-oauth"

const refreshMarginMs = 60_000
const rateLimitRetryDelayMs = 400
const failure = z.looseObject({ error: z.looseObject({ message: z.string().optional() }).optional() })
const profile = z.looseObject({ emailAddress: z.string().min(1) })

/** A Google API answered with an error status; `message` carries Google's own explanation, such as an API not enabled for the project. */
export class GoogleApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/**
 * Kolega's Google connection: one consent for Gmail and Calendar, the stored tokens, the agent's tools and the e-mail watch for Gatilhos.
 * Until the user connects, it costs nothing: no request, no timer. Main opens the consent page because only it has the desktop session.
 */
export class Google {
  private status: GoogleStatus = { state: "disconnected" }
  private authorization?: ReturnType<typeof startAuthorization>
  private refreshing?: Promise<GoogleCredentials>
  private readonly publisher = new EventPublisher<{ status: GoogleStatus }>()
  private readonly mail: MailWatch

  constructor(
    private readonly database: KolegaDatabase,
    private readonly observability: Observability,
    private readonly triggers: Pick<Triggers, "deliver" | "mayMessage" | "wants">,
    private readonly openConsent: (url: string) => void,
    private readonly client?: GoogleClient,
  ) {
    this.mail = new MailWatch({ database, observability, triggers, request: this.request })
  }

  /** Restores a stored connection without calling Google, and starts the e-mail watch when a Gatilho needs it. */
  resume() {
    const account = this.database.state.get("google.account")

    if (!account || !this.database.state.get("google.credentials")) {
      return
    }

    this.publish({ state: "connected", account })
    this.mail.sync(true)
  }

  connect() {
    if (this.status.state !== "disconnected") {
      return this.status
    }

    if (!this.client) {
      this.publish({ state: "disconnected", error: "Este build do Kolega não tem o cliente OAuth do Google." })

      return this.status
    }

    const authorization = startAuthorization(this.client)
    this.authorization = authorization
    this.publish({ state: "connecting" })
    void this.complete(authorization)
    this.openConsent(authorization.authorizationUrl)

    return this.status
  }

  /** Cancels a consent in progress, or revokes the connection and forgets its tokens. */
  async disconnect() {
    this.authorization?.cancel()
    this.authorization = undefined
    const stored = this.database.state.get("google.credentials")

    if (stored) {
      await revokeCredentials(parseCredentials(stored)).catch((error: unknown) => {
        this.observability.event({ name: "google.revokefailed", error })
      })
    }

    this.forget()
    this.publish({ state: "disconnected" })
  }

  async *events(signal?: AbortSignal) {
    const live = this.publisher.subscribe("status", { signal })

    yield this.status
    yield* live
  }

  /** Starts or stops the e-mail watch after a Gatilho changed. */
  watchMail() {
    this.mail.sync(this.status.state === "connected")
  }

  close() {
    this.authorization?.cancel()
    this.mail.close()
  }

  registerTools(server: McpServer) {
    registerGmailTools(server, { request: this.request, triggers: this.triggers, observability: this.observability })
    registerCalendarTools(server, { request: this.request, triggers: this.triggers, observability: this.observability })
  }

  /** Calls a Google API with the stored tokens, refreshing them when they expire or Google rejects them, and parses the answer. */
  readonly request = async <Schema extends z.ZodType>(schema: Schema, url: string, init?: RequestInit): Promise<z.output<Schema>> => {
    const response = await this.send(url, init, true)
    const payload: unknown = response.status === 204 ? {} : await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new GoogleApiError(response.status, `Google answered ${response.status}: ${parse(failure, payload).error?.message ?? "unknown error"}`)
    }

    return parse(schema, payload)
  }

  private async send(url: string, init: RequestInit | undefined, retry: boolean): Promise<Response> {
    const credentials = await this.credentials()
    const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${credentials.accessToken}`, ...(init?.body ? { "content-type": "application/json" } : {}) } })

    if (!retry || (response.status !== 401 && response.status !== 429)) {
      return response
    }

    if (response.status === 401) {
      await this.refresh(credentials)
    } else {
      await Bun.sleep(rateLimitRetryDelayMs)
    }

    return this.send(url, init, false)
  }

  private async credentials() {
    const stored = this.database.state.get("google.credentials")

    if (!stored) {
      throw new Error("Google is not connected. Ask the user to connect it in Conexões.")
    }

    const credentials = parseCredentials(stored)

    if (new Date(credentials.expiresAt).getTime() - Date.now() > refreshMarginMs) {
      return credentials
    }

    return this.refresh(credentials)
  }

  /** One refresh at a time, so parallel calls share it; a grant Google no longer accepts ends the connection. */
  private refresh(credentials: GoogleCredentials) {
    if (!this.client) {
      throw new Error("This Kolega build has no Google OAuth client")
    }

    this.refreshing ??= refreshCredentials(this.client, credentials).then((refreshed) => {
      // A disconnect during the refresh already forgot the tokens; saving these would bring them back.
      if (this.database.state.get("google.credentials")) {
        this.database.state.set("google.credentials", JSON.stringify(refreshed))
      }

      return refreshed
    }, (error: unknown) => {
      if (!(error instanceof GoogleGrantError)) {
        throw error
      }

      this.forget()
      this.publish({ state: "disconnected", error: "O Google encerrou o acesso do Kolega. Conecte de novo." })
      this.observability.event({ name: "google.grantended" })

      throw new Error("Google ended Kolega's access. Ask the user to connect Google again in Conexões.", { cause: error })
    }).finally(() => {
      this.refreshing = undefined
    })

    return this.refreshing
  }

  private async complete(authorization: ReturnType<typeof startAuthorization>) {
    try {
      const credentials = await authorization.credentials
      this.database.state.set("google.credentials", JSON.stringify(credentials))
      const { emailAddress } = await this.request(profile, `${gmailApi}/profile`)

      if (this.authorization !== authorization) {
        return
      }

      this.authorization = undefined
      this.database.state.set("google.account", emailAddress)
      this.publish({ state: "connected", account: emailAddress })
      this.observability.event({ name: "google.connected" })
      this.mail.sync(true)
    } catch (error) {
      if (this.authorization !== authorization) {
        return
      }

      this.authorization = undefined
      this.forget()
      this.observability.event({ name: "google.connectfailed", error })
      this.publish({ state: "disconnected", error: error instanceof GoogleConsentError ? error.message : "O Google não concluiu a conexão. Tente de novo." })
    }
  }

  private forget() {
    this.database.state.set("google.credentials", undefined)
    this.database.state.set("google.account", undefined)
    this.mail.sync(false)
  }

  private publish(status: GoogleStatus) {
    this.status = status
    this.publisher.publish("status", status)
  }
}

export type GoogleRequest = Google["request"]
