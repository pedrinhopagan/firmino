import type { Database } from "bun:sqlite"
import type { WhatsappKey } from "./whatsapp-auth"
import type { WhatsappContact, WhatsappRow } from "./whatsapp-connection"
import type { WhatsappLid } from "./whatsapp-messages"

export const whatsappChatKinds = ["contact", "group", "newsletter", "self"] as const

type ChatKind = (typeof whatsappChatKinds)[number]

interface WhatsappChat {
  chatId: string
  chatName: string
  kind: ChatKind
  lastSentAt: string
  lastSenderName: string
  lastContent: string
  messages: number
}

/** A chat's name: the contact's or group's, or the number of a chat nobody named. */
const chatName = (chatId: string) => `COALESCE(c.name, substr(${chatId}, 1, instr(${chatId}, '@') - 1))`

/**
 * WhatsApp's tables in the Kolega database: messages, one summary row per chat kept in step with them,
 * contact names, LID mappings and the linked account's Signal keys.
 * Chats are kept under one canonical id per person: a LID moves to its phone-number jid as soon as a mapping arrives.
 */
export function openWhatsappStore(db: Database) {
  db.run(`CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    from_me INTEGER NOT NULL,
    content TEXT NOT NULL,
    sent_at TEXT NOT NULL
  )`)
  db.run("CREATE INDEX IF NOT EXISTS whatsapp_messages_chat ON whatsapp_messages (chat_id, sent_at)")
  db.run(`CREATE TABLE IF NOT EXISTS whatsapp_chats (
    chat_id TEXT PRIMARY KEY,
    last_sent_at TEXT NOT NULL,
    last_sender_name TEXT NOT NULL,
    last_content TEXT NOT NULL,
    messages INTEGER NOT NULL
  )`)
  db.run("CREATE INDEX IF NOT EXISTS whatsapp_chats_recent ON whatsapp_chats (last_sent_at)")
  db.run("CREATE TABLE IF NOT EXISTS whatsapp_contacts (jid TEXT PRIMARY KEY, name TEXT NOT NULL)")
  db.run("CREATE TABLE IF NOT EXISTS whatsapp_lids (lid TEXT PRIMARY KEY, pn TEXT NOT NULL)")
  db.run("CREATE TABLE IF NOT EXISTS whatsapp_keys (type TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (type, id))")

  const insertMessage = db.query<null, Omit<WhatsappRow, "fromMe"> & { fromMe: number }>("INSERT OR IGNORE INTO whatsapp_messages (id, chat_id, sender_name, from_me, content, sent_at) VALUES ($id, $chatId, $senderName, $fromMe, $content, $sentAt)")
  const updateMessage = db.query<null, Pick<WhatsappRow, "id" | "senderName" | "content">>("UPDATE whatsapp_messages SET sender_name = $senderName, content = $content WHERE id = $id")
  // SET expressions read the row as it was, so each column compares against the previous latest message.
  const bumpChat = db.query<null, Pick<WhatsappRow, "chatId" | "sentAt" | "senderName" | "content"> & { added: number }>(`INSERT INTO whatsapp_chats (chat_id, last_sent_at, last_sender_name, last_content, messages) VALUES ($chatId, $sentAt, $senderName, $content, $added)
    ON CONFLICT (chat_id) DO UPDATE SET messages = messages + excluded.messages,
      last_sent_at = MAX(last_sent_at, excluded.last_sent_at),
      last_sender_name = CASE WHEN excluded.last_sent_at >= last_sent_at THEN excluded.last_sender_name ELSE last_sender_name END,
      last_content = CASE WHEN excluded.last_sent_at >= last_sent_at THEN excluded.last_content ELSE last_content END`)
  const summarizeChat = db.query<null, { chatId: string }>(`INSERT OR REPLACE INTO whatsapp_chats (chat_id, last_sent_at, last_sender_name, last_content, messages)
    SELECT chat_id, sent_at, sender_name, content, (SELECT COUNT(*) FROM whatsapp_messages WHERE chat_id = $chatId) FROM whatsapp_messages WHERE chat_id = $chatId ORDER BY sent_at DESC, rowid DESC LIMIT 1`)
  const saveContact = db.query<null, { jid: string; name: string }>("INSERT INTO whatsapp_contacts (jid, name) VALUES ($jid, $name) ON CONFLICT (jid) DO UPDATE SET name = excluded.name")
  const saveLid = db.query<null, { lid: string; pn: string }>("INSERT INTO whatsapp_lids (lid, pn) VALUES ($lid, $pn) ON CONFLICT (lid) DO UPDATE SET pn = excluded.pn")
  const moveMessages = db.query<null, { lid: string; pn: string }>(`INSERT OR IGNORE INTO whatsapp_messages (id, chat_id, sender_name, from_me, content, sent_at)
    SELECT $pn || substr(id, length($lid) + 1), $pn, sender_name, from_me, content, sent_at FROM whatsapp_messages WHERE chat_id = $lid`)
  const dropLidMessages = db.query<null, { lid: string }>("DELETE FROM whatsapp_messages WHERE chat_id = $lid")
  const dropLidChat = db.query<null, { lid: string }>("DELETE FROM whatsapp_chats WHERE chat_id = $lid")
  const moveContact = db.query<null, { lid: string; pn: string }>("INSERT OR IGNORE INTO whatsapp_contacts (jid, name) SELECT $pn, name FROM whatsapp_contacts WHERE jid = $lid")
  const dropLidContact = db.query<null, { lid: string }>("DELETE FROM whatsapp_contacts WHERE jid = $lid")
  // SQLite lets WHERE use the kind alias, so the filter and the limit stay in one indexed pass over the most recent chats.
  const listChats = db.query<WhatsappChat, { search: string | null; kinds: string; self: string; limit: number }>(`SELECT w.chat_id AS chatId, ${chatName("w.chat_id")} AS chatName,
      CASE WHEN w.chat_id LIKE '%@g.us' THEN 'group' WHEN w.chat_id LIKE '%@newsletter' THEN 'newsletter' WHEN w.chat_id = $self THEN 'self' ELSE 'contact' END AS kind,
      w.last_sent_at AS lastSentAt, w.last_sender_name AS lastSenderName, w.last_content AS lastContent, w.messages
    FROM whatsapp_chats w LEFT JOIN whatsapp_contacts c ON c.jid = w.chat_id
    WHERE kind IN (SELECT value FROM json_each($kinds)) AND ($search IS NULL OR c.name LIKE '%' || $search || '%' OR w.chat_id LIKE '%' || $search || '%')
    ORDER BY w.last_sent_at DESC LIMIT $limit`)
  const readChat = db.query<Omit<WhatsappRow, "fromMe"> & { chatName: string; fromMe: number }, { chatId: string; limit: number }>(`SELECT m.id, m.chat_id AS chatId, ${chatName("m.chat_id")} AS chatName, m.sender_name AS senderName, m.from_me AS fromMe, m.content, m.sent_at AS sentAt
    FROM whatsapp_messages m LEFT JOIN whatsapp_contacts c ON c.jid = m.chat_id
    WHERE m.chat_id = $chatId ORDER BY m.sent_at DESC, m.rowid DESC LIMIT $limit`)
  const unmappedLids = db.query<{ chatId: string }, []>("SELECT chat_id AS chatId FROM whatsapp_chats WHERE chat_id LIKE '%@lid'")
  const allContacts = db.query<WhatsappContact, []>("SELECT jid, name FROM whatsapp_contacts")
  const allLids = db.query<WhatsappLid, []>("SELECT lid, pn FROM whatsapp_lids")
  const allKeys = db.query<{ type: string; id: string; value: string }, []>("SELECT type, id, value FROM whatsapp_keys")
  const saveKey = db.query<null, { type: string; id: string; value: string }>("INSERT INTO whatsapp_keys (type, id, value) VALUES ($type, $id, $value) ON CONFLICT (type, id) DO UPDATE SET value = excluded.value")
  const dropKey = db.query<null, { type: string; id: string }>("DELETE FROM whatsapp_keys WHERE type = $type AND id = $id")

  return {
    save: db.transaction((rows: WhatsappRow[]) => {
      for (const row of rows) {
        const added = insertMessage.run({ ...row, fromMe: row.fromMe ? 1 : 0 }).changes

        if (!added) {
          updateMessage.run(row)
        }

        bumpChat.run({ ...row, added })
      }
    }),
    saveContacts: db.transaction((contacts: WhatsappContact[]) => {
      for (const contact of contacts) {
        saveContact.run(contact)
      }
    }),
    /** Records LID mappings and moves every row stored under each LID to its phone-number jid. */
    mapLids: db.transaction((pairs: WhatsappLid[]) => {
      for (const pair of pairs) {
        saveLid.run(pair)
        moveMessages.run(pair)
        dropLidMessages.run(pair)
        dropLidChat.run(pair)
        summarizeChat.run({ chatId: pair.pn })
        moveContact.run(pair)
        dropLidContact.run(pair)
      }
    }),
    contacts: () => allContacts.all(),
    lids: () => allLids.all(),
    /** Chats most recent first, filtered and limited in SQL; `self` is the account's own jid. */
    chats: (filter: { search?: string; kinds: readonly ChatKind[]; self: string; limit: number }) => listChats.all({ search: filter.search ?? null, kinds: JSON.stringify(filter.kinds), self: filter.self, limit: filter.limit }),
    /** The latest `limit` messages of a chat, oldest first. */
    read: (chatId: string, limit: number) => readChat.all({ chatId, limit }).map((row) => ({ ...row, fromMe: row.fromMe === 1 })).toReversed(),
    /** Chats still under a LID, whose phone number no source has given yet. */
    unmappedLids: () => unmappedLids.all().map((row) => row.chatId),
    keys: () => allKeys.all(),
    saveKeys: db.transaction((keys: WhatsappKey[]) => {
      for (const key of keys) {
        if (key.value === null) {
          dropKey.run(key)
        } else {
          saveKey.run({ ...key, value: key.value })
        }
      }
    }),
    clear() {
      for (const table of ["whatsapp_messages", "whatsapp_chats", "whatsapp_contacts", "whatsapp_lids", "whatsapp_keys"]) {
        db.run(`DELETE FROM ${table}`)
      }
    },
  }
}
