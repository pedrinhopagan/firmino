import { Database } from "bun:sqlite"
import type { ConversationMessage, ProviderId } from "@src/shared/conversation"

/** Small persisted values: the active provider, its model and each provider's session to resume. */
type StateKey = "provider" | `model.${ProviderId}` | `session.${ProviderId}`

const messagePageSize = 50
const transcriptLimit = 20

/** Opens the Kolega SQLite file and creates its tables on first use. */
export function openDatabase(path: string) {
  const db = new Database(path, { create: true, strict: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    text TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude')),
    created_at TEXT NOT NULL
  )`)
  db.run("CREATE INDEX IF NOT EXISTS messages_answers ON messages (provider, role, id)")
  db.run("CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)")

  const columns = "id, role, text, provider, created_at AS createdAt"
  const pageMessages = db.query<ConversationMessage, { before: number; limit: number }>(`SELECT ${columns} FROM messages WHERE id < $before ORDER BY id DESC LIMIT $limit`)
  const unseenMessages = db.query<ConversationMessage, { provider: ProviderId; limit: number }>(`SELECT ${columns} FROM messages WHERE id > COALESCE((SELECT MAX(id) FROM messages WHERE provider = $provider AND role = 'assistant'), 0) ORDER BY id DESC LIMIT $limit`)
  const insertMessage = db.query<ConversationMessage, Omit<ConversationMessage, "id">>(`INSERT INTO messages (role, text, provider, created_at) VALUES ($role, $text, $provider, $createdAt) RETURNING ${columns}`)
  const readState = db.query<{ value: string }, { key: StateKey }>("SELECT value FROM state WHERE key = $key")
  const writeState = db.query<null, { key: StateKey; value: string }>("INSERT INTO state (key, value) VALUES ($key, $value) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
  const deleteState = db.query<null, { key: StateKey }>("DELETE FROM state WHERE key = $key")

  return {
    messages: {
      /** The newest messages older than `before`, oldest first, and the cursor for the page before them. */
      page(before?: number) {
        const rows = pageMessages.all({ before: before ?? Number.MAX_SAFE_INTEGER, limit: messagePageSize + 1 })
        const messages = rows.slice(0, messagePageSize).toReversed()
        const oldest = messages[0]

        return { messages, ...(rows.length > messagePageSize && oldest ? { before: oldest.id } : {}) }
      },
      /** The latest messages since the provider's last answer, oldest first: what it has not seen. A turn stopped before delivery leaves no answer, so its context is sent again. */
      unseenBy: (provider: ProviderId) => unseenMessages.all({ provider, limit: transcriptLimit }).toReversed(),
      insert(message: Omit<ConversationMessage, "id" | "createdAt">) {
        const row = insertMessage.get({ ...message, createdAt: new Date().toISOString() })

        if (!row) {
          throw new Error("Message insert returned no row")
        }

        return row
      },
    },
    state: {
      get: (key: StateKey) => readState.get({ key })?.value,
      set(key: StateKey, value: string | undefined) {
        if (value === undefined) {
          deleteState.run({ key })

          return
        }

        writeState.run({ key, value })
      },
    },
    close: () => db.close(),
  }
}

export type KolegaDatabase = ReturnType<typeof openDatabase>
