import { Database } from "bun:sqlite"
import type { ConversationMessage, ProviderId } from "@src/shared/conversation"
import { parse } from "@src/shared/parse"
import { type Routine, storedRoutine } from "./routines"
import { storedTrigger, type Trigger } from "./triggers"
import { openWhatsappStore } from "./whatsapp/whatsapp-store"

/** Small persisted values: the active provider, its model, each provider's session to resume, the linked WhatsApp account with its keys, and the Google account with its tokens and the Gmail history id e-mail Gatilhos watch from. */
type StateKey = "provider" | `model.${ProviderId}` | `session.${ProviderId}` | "whatsapp.auth" | "whatsapp.account" | "google.credentials" | "google.account" | "google.historyId"

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
    routine TEXT,
    created_at TEXT NOT NULL
  )`)

  if (!db.query("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'routine'").get()) {
    db.run("ALTER TABLE messages ADD COLUMN routine TEXT")
  }

  if (!db.query("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'trigger'").get()) {
    db.run("ALTER TABLE messages ADD COLUMN trigger TEXT")
  }

  db.run("CREATE INDEX IF NOT EXISTS messages_answers ON messages (provider, role, id)")
  db.run("CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  db.run(`CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    frequency TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'failed')),
    next_run_at TEXT,
    created_at TEXT NOT NULL
  )`)
  db.run("CREATE INDEX IF NOT EXISTS routines_due ON routines (status, next_run_at)")
  db.run(`CREATE TABLE IF NOT EXISTS triggers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    instruction TEXT NOT NULL,
    source TEXT NOT NULL,
    targets TEXT NOT NULL,
    can_send INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
    created_at TEXT NOT NULL
  )`)
  db.run("CREATE INDEX IF NOT EXISTS triggers_listening ON triggers (source, status)")

  const columns = "id, role, text, provider, routine, trigger, created_at AS createdAt"
  const pageMessages = db.query<ConversationMessage, { before: number; limit: number }>(`SELECT ${columns} FROM messages WHERE id < $before ORDER BY id DESC LIMIT $limit`)
  const unseenMessages = db.query<ConversationMessage, { provider: ProviderId; limit: number }>(`SELECT ${columns} FROM messages WHERE id > COALESCE((SELECT MAX(id) FROM messages WHERE provider = $provider AND role = 'assistant'), 0) ORDER BY id DESC LIMIT $limit`)
  const insertMessage = db.query<ConversationMessage, Omit<ConversationMessage, "id">>(`INSERT INTO messages (role, text, provider, routine, trigger, created_at) VALUES ($role, $text, $provider, $routine, $trigger, $createdAt) RETURNING ${columns}`)
  const readState = db.query<{ value: string }, { key: StateKey }>("SELECT value FROM state WHERE key = $key")
  const writeState = db.query<null, { key: StateKey; value: string }>("INSERT INTO state (key, value) VALUES ($key, $value) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
  const deleteState = db.query<null, { key: StateKey }>("DELETE FROM state WHERE key = $key")
  const routineColumns = "id, name, prompt, frequency, status, next_run_at AS nextRunAt, created_at AS createdAt"
  const allRoutines = db.query<unknown, []>(`SELECT ${routineColumns} FROM routines ORDER BY created_at`)
  const readRoutine = db.query<unknown, { id: string }>(`SELECT ${routineColumns} FROM routines WHERE id = $id`)
  const dueRoutines = db.query<unknown, { before: string }>(`SELECT ${routineColumns} FROM routines WHERE status = 'active' AND next_run_at <= $before ORDER BY next_run_at`)
  const nextRun = db.query<{ nextRunAt: string | null }, []>("SELECT MIN(next_run_at) AS nextRunAt FROM routines WHERE status = 'active' AND next_run_at IS NOT NULL")
  const saveRoutine = db.query<null, Omit<Routine, "frequency"> & { frequency: string }>(`INSERT INTO routines (id, name, prompt, frequency, status, next_run_at, created_at) VALUES ($id, $name, $prompt, $frequency, $status, $nextRunAt, $createdAt)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, prompt = excluded.prompt, frequency = excluded.frequency, status = excluded.status, next_run_at = excluded.next_run_at`)
  const deleteRoutine = db.query<null, { id: string }>("DELETE FROM routines WHERE id = $id")
  const routines = (rows: unknown[]) => rows.map((row) => parse(storedRoutine, row))
  const triggerColumns = "id, name, instruction, source, targets, can_send AS canSend, status, created_at AS createdAt"
  const allTriggers = db.query<unknown, []>(`SELECT ${triggerColumns} FROM triggers ORDER BY created_at`)
  const readTrigger = db.query<unknown, { id: string }>(`SELECT ${triggerColumns} FROM triggers WHERE id = $id`)
  const saveTrigger = db.query<null, Omit<Trigger, "targets" | "canSend"> & { targets: string; canSend: number }>(`INSERT INTO triggers (id, name, instruction, source, targets, can_send, status, created_at) VALUES ($id, $name, $instruction, $source, $targets, $canSend, $status, $createdAt)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, instruction = excluded.instruction, source = excluded.source, targets = excluded.targets, can_send = excluded.can_send, status = excluded.status`)
  const listeningTriggers = db.query<unknown, { source: string }>(`SELECT ${triggerColumns} FROM triggers WHERE status = 'active' AND source = $source`)
  const deleteTrigger = db.query<null, { id: string }>("DELETE FROM triggers WHERE id = $id")
  const triggers = (rows: unknown[]) => rows.map((row) => parse(storedTrigger, row))
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
      insert(message: Pick<ConversationMessage, "role" | "text" | "provider"> & { routine?: string; trigger?: string }) {
        const row = insertMessage.get({ ...message, routine: message.routine ?? null, trigger: message.trigger ?? null, createdAt: new Date().toISOString() })

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
    routines: {
      list: () => routines(allRoutines.all()),
      get: (id: string) => routines(readRoutine.all({ id }))[0],
      /** Active Rotinas whose run time is at or before `before`, earliest first. */
      due: (before: Date) => routines(dueRoutines.all({ before: before.toISOString() })),
      /** When the earliest active Rotina runs; absent when none is waiting. */
      nextRunAt: () => nextRun.get()?.nextRunAt ?? undefined,
      save: (routine: Routine) => saveRoutine.run({ ...routine, frequency: JSON.stringify(routine.frequency) }),
      remove: (id: string) => deleteRoutine.run({ id }),
    },
    triggers: {
      list: () => triggers(allTriggers.all()),
      get: (id: string) => triggers(readTrigger.all({ id }))[0],
      /** Active Gatilhos on one source. */
      listening: (source: Trigger["source"]) => triggers(listeningTriggers.all({ source })),
      save: (trigger: Trigger) => saveTrigger.run({ ...trigger, targets: JSON.stringify(trigger.targets), canSend: trigger.canSend ? 1 : 0 }),
      remove: (id: string) => deleteTrigger.run({ id }),
    },
    whatsapp: openWhatsappStore(db),
    close: () => db.close(),
  }
}

export type KolegaDatabase = ReturnType<typeof openDatabase>
