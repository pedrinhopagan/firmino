import { Browsers, DisconnectReason, jidNormalizedUser, makeWASocket, type WAMessage, type WASocket } from "baileys"
import { whatsappAuth, type WhatsappKey, type WhatsappSavedAuth } from "./whatsapp-auth"
import { canonicalJid, lidPair, messageLids, messageRow, nameOf, type WhatsappLid } from "./whatsapp-messages"

/**
 * The only module that loads Baileys. The Engine build compiles it as a second entrypoint and imports it by a computed path,
 * so the Engine boot never parses Baileys; it loads when WhatsApp is linked or being linked.
 * It imports nothing from the rest of the Engine, which would be bundled a second time.
 */

/** A stored WhatsApp message: text, or a marker such as [image] for other kinds. */
export interface WhatsappRow {
  id: string
  chatId: string
  senderName: string
  fromMe: boolean
  content: string
  sentAt: string
}

export interface WhatsappContact { jid: string; name: string }

export interface WhatsappEvents {
  qr(code: string): void
  open(account: string): void
  reconnecting(reason: string): void
  /** The session ended for good: WhatsApp signed the device out, or the QR codes expired before anyone linked. Nothing is persisted after it. */
  ended(reason: "logged-out" | "expired"): void
  /** Auth to persist, only while the account is linked: the creds when they change, and each batch of Signal key writes. */
  auth(change: { creds?: string; keys?: WhatsappKey[] }): void
  /** LIDs newly mapped to phone numbers; sent before any message or contact that uses them. */
  lids(lids: WhatsappLid[]): void
  /** `live` marks messages that just arrived, as opposed to history and offline catch-up. */
  messages(rows: WhatsappRow[], live: boolean): void
  contacts(contacts: WhatsappContact[]): void
  error(message: string): void
}

const reconnectDelayMs = 3000

interface ContactUpdate { id?: string | null; lid?: string | null; phoneNumber?: string | null; name?: string | null; notify?: string | null; verifiedName?: string | null }

export function connectWhatsapp(options: { auth?: WhatsappSavedAuth; contacts: WhatsappContact[]; lids: WhatsappLid[]; on: WhatsappEvents }) {
  const { on } = options
  /** True while the account is linked and the session lives: the only time auth is written. */
  let persisting = !!options.auth
  const auth = whatsappAuth(options.auth, (keys) => {
    if (persisting) {
      on.auth({ keys })
    }
  })
  const names = new Map(options.contacts.map((contact) => [contact.jid, contact.name]))
  const phones = new Map(options.lids.map((pair) => [pair.lid, pair.pn]))
  let current: WASocket | undefined
  let closed = false

  function learn(pairs: (WhatsappLid | undefined)[]) {
    const fresh = pairs.flatMap((pair) => {
      const normalized = pair && lidPair(pair.lid, pair.pn)

      if (!normalized || phones.get(normalized.lid) === normalized.pn) {
        return []
      }

      phones.set(normalized.lid, normalized.pn)
      const name = names.get(normalized.lid)

      if (name && !names.has(normalized.pn)) {
        names.set(normalized.pn, name)
      }

      return [normalized]
    })

    if (fresh.length > 0) {
      on.lids(fresh)
    }
  }

  function remember(contacts: ContactUpdate[]) {
    learn(contacts.map((contact) => lidPair(contact.lid ?? contact.id, contact.phoneNumber ?? contact.id)))
    const known = contacts.flatMap((contact) => {
      const jid = canonicalJid(contact.id, phones)
      const name = nameOf(contact)

      if (!jid || !name || names.get(jid) === name) {
        return []
      }

      names.set(jid, name)

      return [{ jid, name }]
    })

    if (known.length > 0) {
      on.contacts(known)
    }
  }

  function rows(messages: WAMessage[]) {
    learn(messages.flatMap(messageLids))

    return messages.flatMap((message) => messageRow(message, names, phones) ?? [])
  }

  function start() {
    const silent = { level: "silent", child: () => silent, trace() {}, debug() {}, info() {}, warn() {}, error: (value: unknown, message?: string) => on.error(message ?? String(value)) }
    const socket = makeWASocket({
      auth: auth.state,
      logger: silent,
      browser: Browsers.ubuntu("Chrome"),
      syncFullHistory: true,
      shouldSyncHistoryMessage: () => true,
      markOnlineOnConnect: false,
    })
    current = socket

    socket.ev.on("creds.update", () => {
      if (persisting) {
        on.auth({ creds: auth.creds() })
      }
    })
    socket.ev.on("lid-mapping.update", (pair) => learn([pair]))
    socket.ev.on("contacts.upsert", remember)
    socket.ev.on("contacts.update", remember)
    socket.ev.on("chats.upsert", (chats) => remember(chats.map((chat) => ({ id: chat.id, name: chat.name }))))
    socket.ev.on("groups.upsert", (groups) => remember(groups.map((group) => ({ id: group.id, name: group.subject }))))
    socket.ev.on("groups.update", (groups) => remember(groups.map((group) => ({ id: group.id, name: group.subject }))))
    socket.ev.on("messaging-history.set", (history) => {
      learn(history.lidPnMappings ?? [])
      remember(history.contacts)
      remember(history.chats.map((chat) => ({ id: chat.id, name: chat.name })))
      on.messages(rows(history.messages), false)
    })
    socket.ev.on("messages.upsert", (upsert) => on.messages(rows(upsert.messages), upsert.type === "notify"))
    socket.ev.on("connection.update", (update) => {
      if (update.qr) {
        on.qr(update.qr)
      }

      if (update.connection === "open") {
        // The first open after a scan: from now on the account is linked, and its keys so far are written at once.
        if (!persisting) {
          persisting = true
          on.auth({ keys: auth.keys() })
        }

        on.auth({ creds: auth.creds() })
        on.open(jidNormalizedUser(socket.user?.id ?? "").split("@")[0] ?? "WhatsApp")
      }

      if (update.connection === "close" && !closed) {
        reconnect(update.lastDisconnect?.error)
      }
    })
  }

  function end(reason: "logged-out" | "expired") {
    closed = true
    persisting = false
    on.ended(reason)
  }

  function reconnect(cause?: Error) {
    current = undefined
    const status = (cause as { output?: { statusCode?: number } } | undefined)?.output?.statusCode

    if (status === DisconnectReason.loggedOut) {
      end("logged-out")

      return
    }

    // Scanning the code closes the socket with restartRequired; any other close before linking means the codes ran out.
    if (!persisting && status !== DisconnectReason.restartRequired) {
      end("expired")

      return
    }

    on.reconnecting(cause?.message ?? "closed")
    setTimeout(() => {
      if (!closed) {
        start()
      }
    }, status === DisconnectReason.restartRequired ? 0 : reconnectDelayMs)
  }

  function socket() {
    if (!current?.user) {
      throw new Error("WhatsApp is not connected right now")
    }

    return current
  }

  start()

  return {
    /** Sends a text and returns it as stored; nothing when WhatsApp did not echo it back. */
    async send(chatId: string, text: string) {
      const sent = await socket().sendMessage(chatId, { text })

      if (!sent) {
        throw new Error(`WhatsApp did not confirm the message to ${chatId}`)
      }

      return rows([sent])[0]
    },
    /** Asks WhatsApp for the phone numbers of LIDs no source mapped yet. */
    async resolveLids(lids: string[]) {
      learn(await socket().signalRepository.lidMapping.getPNsForLIDs(lids) ?? [])
    },
    /** Signs this device out of the account, as removing it on the phone would. */
    async logout() {
      closed = true
      persisting = false
      await current?.logout()
      current = undefined
    },
    close() {
      closed = true
      persisting = false
      void current?.end(undefined)
      current = undefined
    },
  }
}

export type WhatsappConnection = ReturnType<typeof connectWhatsapp>
