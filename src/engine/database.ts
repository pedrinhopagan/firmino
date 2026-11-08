import { Database } from "bun:sqlite"
import { z } from "zod"
import { type ConversationMessage, conversationMessage, workEntry } from "@src/shared/conversation"
import { type StoredAppointment, storedAppointment } from "./appointments"
import { parse } from "@src/shared/parse"
import type { Routine } from "@src/shared/routine"
import type { StoredMemory } from "@src/shared/memory"
import { storedRoutine } from "./routines"
import type { Trigger } from "@src/shared/trigger"
import { storedTrigger } from "./triggers"
import { openWhatsappStore } from "./whatsapp/whatsapp-store"

/** Small persisted values: the provider accounts, the active account, each account's model and session to resume, each model's effort, how many memories each provider session has read, the favorite models, the linked WhatsApp account with its keys, the Google account with its tokens and the Gmail history id e-mail Gatilhos watch from, and the Discord account with its token. */
type StateKey = "accounts" | "account" | "favorites" | `model.${string}` | `effort.${string}` | `session.${string}` | `memory.read.${string}` | "whatsapp.auth" | "whatsapp.account" | "google.credentials" | "google.account" | "google.historyId" | "discord.token" | "discord.account" | "zen.identity"

/** A messages row, whose work log is JSON and exists only on answers that did some work. */
const storedMessage = conversationMessage.omit({ work: true })
  .extend({ work: z.string().transform((value): unknown => JSON.parse(value)).pipe(z.array(workEntry)).nullable() })
  .transform(({ work, ...message }): ConversationMessage => ({ ...message, ...(work ? { work } : {}) }))

const messagePageSize = 50
const transcriptLimit = 20

/** Opens the Firmino SQLite file and creates its tables on first use. */
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

  if (!db.query("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'account'").get()) {
    db.run("ALTER TABLE messages ADD COLUMN account TEXT")
  }

  if (!db.query("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'work'").get()) {
    db.run("ALTER TABLE messages ADD COLUMN work TEXT")
  }

  // Messages from before provider accounts belong to the default account, whose id is the provider's.
  // It runs on every start, because an Engine from before accounts can still write to this file after the column exists.
  db.run("UPDATE messages SET account = provider WHERE account IS NULL")

  db.run("DROP INDEX IF EXISTS messages_answers")
  db.run("CREATE INDEX IF NOT EXISTS messages_account_answers ON messages (account, role, id)")
  db.run("CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  // The provider chosen before accounts is now its default account, whose id is the provider's.
  db.run("INSERT OR IGNORE INTO state (key, value) SELECT 'account', value FROM state WHERE key = 'provider'")
  db.run("DELETE FROM state WHERE key = 'provider'")
  // Favorites starred per provider, before accounts, belong to the provider's default account.
  db.run("INSERT OR IGNORE INTO state (key, value) SELECT 'favorites', (SELECT json_group_array(json_object('account', json_extract(favorite.value, '$.provider'), 'model', json_extract(favorite.value, '$.model'))) FROM json_each(state.value) AS favorite) FROM state WHERE key = 'model.favorites'")
  db.run("DELETE FROM state WHERE key = 'model.favorites'")
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
  db.run(`CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT,
    remind_minutes INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'done')),
    notice_at TEXT NOT NULL,
    next_alert_at TEXT,
    alerted_at TEXT,
    dismissed_at TEXT,
    created_at TEXT NOT NULL
  )`)
  db.run("CREATE INDEX IF NOT EXISTS appointments_alert ON appointments (status, next_alert_at)")
  db.run(`CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    text TEXT NOT NULL
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS memory_summaries (
    size INTEGER NOT NULL,
    lo INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (size, lo)
  ) WITHOUT ROWID`)

  const columns = "id, role, text, provider, account, routine, trigger, work, created_at AS createdAt"
  const pageMessages = db.query<unknown, { before: number; limit: number }>(`SELECT ${columns} FROM messages WHERE id < $before ORDER BY id DESC LIMIT $limit`)
  const unseenMessages = db.query<unknown, { account: string; limit: number }>(`SELECT ${columns} FROM messages WHERE id > COALESCE((SELECT MAX(id) FROM messages WHERE account = $account AND role = 'assistant'), 0) ORDER BY id DESC LIMIT $limit`)
  const insertMessage = db.query<unknown, Omit<ConversationMessage, "id" | "work"> & { work: string | null }>(`INSERT INTO messages (role, text, provider, account, routine, trigger, work, created_at) VALUES ($role, $text, $provider, $account, $routine, $trigger, $work, $createdAt) RETURNING ${columns}`)
  const messages = (rows: unknown[]) => rows.map((row) => parse(storedMessage, row))
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
  const appointmentColumns = "id, title, date, time, remind_minutes AS remindMinutes, status, notice_at AS noticeAt, next_alert_at AS nextAlertAt, alerted_at AS alertedAt, dismissed_at AS dismissedAt, created_at AS createdAt"
  const allAppointments = db.query<unknown, []>(`SELECT ${appointmentColumns} FROM appointments ORDER BY date, COALESCE(time, ''), created_at`)
  const readAppointment = db.query<unknown, { id: string }>(`SELECT ${appointmentColumns} FROM appointments WHERE id = $id`)
  const dueAppointments = db.query<unknown, { before: string }>(`SELECT ${appointmentColumns} FROM appointments WHERE status = 'pending' AND next_alert_at <= $before`)
  const nextAlert = db.query<{ nextAlertAt: string | null }, []>("SELECT MIN(next_alert_at) AS nextAlertAt FROM appointments WHERE status = 'pending' AND next_alert_at IS NOT NULL")
  const saveAppointment = db.query<null, StoredAppointment>(`INSERT INTO appointments (id, title, date, time, remind_minutes, status, notice_at, next_alert_at, alerted_at, dismissed_at, created_at) VALUES ($id, $title, $date, $time, $remindMinutes, $status, $noticeAt, $nextAlertAt, $alertedAt, $dismissedAt, $createdAt)
    ON CONFLICT (id) DO UPDATE SET title = excluded.title, date = excluded.date, time = excluded.time, remind_minutes = excluded.remind_minutes, status = excluded.status, notice_at = excluded.notice_at, next_alert_at = excluded.next_alert_at, alerted_at = excluded.alerted_at, dismissed_at = excluded.dismissed_at`)
  const deleteAppointment = db.query<null, { id: string }>("DELETE FROM appointments WHERE id = $id")
  const appointments = (rows: unknown[]) => rows.map((row) => parse(storedAppointment, row))
  const memoryCount = db.query<{ count: number }, []>("SELECT COALESCE(MAX(id) + 1, 0) AS count FROM memories")
  const memoryRange = db.query<StoredMemory, { lo: number; hi: number }>("SELECT id, date, text FROM memories WHERE id >= $lo AND id < $hi AND text <> '' ORDER BY id")
  const allMemories = db.query<StoredMemory, []>("SELECT id, date, text FROM memories WHERE text <> '' ORDER BY id")
  const appendMemory = db.query<{ id: number }, Omit<StoredMemory, "id">>("INSERT INTO memories (id, date, text) SELECT COALESCE(MAX(id) + 1, 0), $date, $text FROM memories RETURNING id")
  const readSummary = db.query<{ text: string }, { lo: number; size: number }>("SELECT text FROM memory_summaries WHERE size = $size AND lo = $lo")
  // The first unsummarized block is at 0 or right after a summarized one.
  const summaryLevel = db.query<{ done: number; next: number }, { size: number }>(`SELECT COUNT(*) AS done, (
    SELECT MIN(start.lo) FROM (SELECT 0 AS lo UNION SELECT lo + $size FROM memory_summaries WHERE size = $size) start
    WHERE NOT EXISTS (SELECT 1 FROM memory_summaries s WHERE s.size = $size AND s.lo = start.lo)
  ) AS next FROM memory_summaries WHERE size = $size`)
  const insertSummary = db.query<null, { lo: number; size: number; text: string }>("INSERT INTO memory_summaries (size, lo, text) VALUES ($size, $lo, $text)")
  const forgetMemories = db.transaction((ids: number[]) => {
    const forgotten = ids.filter((id) => db.run("UPDATE memories SET text = '' WHERE id = ? AND text <> ''", [id]).changes > 0)

    for (const id of forgotten) {
      db.run("DELETE FROM memory_summaries WHERE lo <= ? AND ? < lo + size", [id, id])
    }

    if (forgotten.length > 0) {
      db.run("UPDATE state SET value = '-1' WHERE key LIKE 'memory.read.%'")
    }

    return forgotten
  })
  const clearMemories = db.transaction(() => {
    db.run("DELETE FROM memories")
    db.run("DELETE FROM memory_summaries")
    db.run("UPDATE state SET value = '-1' WHERE key LIKE 'memory.read.%'")
  })
  return {
    messages: {
      /** The newest messages older than `before`, oldest first, and the cursor for the page before them. */
      page(before?: number) {
        const rows = messages(pageMessages.all({ before: before ?? Number.MAX_SAFE_INTEGER, limit: messagePageSize + 1 }))
        const page = rows.slice(0, messagePageSize).toReversed()
        const oldest = page[0]

        return { messages: page, ...(rows.length > messagePageSize && oldest ? { before: oldest.id } : {}) }
      },
      /** The latest messages since the account's last answer, oldest first: what it has not seen. A turn stopped before delivery leaves no answer, so its context is sent again. */
      unseenBy: (account: string) => messages(unseenMessages.all({ account, limit: transcriptLimit })).toReversed(),
      insert(message: Pick<ConversationMessage, "role" | "text" | "provider" | "account" | "work"> & { routine?: string; trigger?: string }) {
        const row = insertMessage.get({ ...message, routine: message.routine ?? null, trigger: message.trigger ?? null, work: message.work ? JSON.stringify(message.work) : null, createdAt: new Date().toISOString() })

        if (!row) {
          throw new Error("Message insert returned no row")
        }

        return parse(storedMessage, row)
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
    appointments: {
      /** By day and time, a whole-day one first. */
      list: () => appointments(allAppointments.all()),
      get: (id: string) => appointments(readAppointment.all({ id }))[0],
      /** Pending Compromissos whose next alert is at or before `before`. */
      due: (before: Date) => appointments(dueAppointments.all({ before: before.toISOString() })),
      /** When the earliest pending Compromisso alerts; absent when none waits. */
      nextAlertAt: () => nextAlert.get()?.nextAlertAt ?? undefined,
      save: (appointment: StoredAppointment) => saveAppointment.run(appointment),
      remove: (id: string) => deleteAppointment.run({ id }),
    },
    /**
     * The memory log, append-only with ids from 0, and the summaries of its aligned power-of-two blocks, each level filled in order.
     * A forgotten memory keeps its id with its text erased, and the summaries over it go, so each level may have one gap to fill again. A block with nothing left is summarized as "".
     */
    memories: {
      count: () => memoryCount.get()?.count ?? 0,
      /** The memories lo through hi - 1 that are not forgotten. */
      range: (lo: number, hi: number) => memoryRange.all({ lo, hi }),
      all: () => allMemories.all(),
      append(memory: Omit<StoredMemory, "id">) {
        const row = appendMemory.get(memory)

        if (!row) {
          throw new Error("Memory insert returned no row")
        }

        return row.id
      },
      /** The summary of memories lo through lo + size - 1. */
      summary: (lo: number, size: number) => readSummary.get({ lo, size })?.text,
      /** How many blocks of this size are summarized, and where the first one that is not starts. */
      level: (size: number) => summaryLevel.get({ size }) ?? { done: 0, next: 0 },
      summarize: (lo: number, size: number, text: string) => insertSummary.run({ lo, size, text }),
      /** Erases the text of these memories and the summaries over them, and marks every session that read the memory as holding memories that are gone (-1). Returns the ids it erased. */
      forget: (ids: number[]) => forgetMemories(ids),
      /** Erases the log and its summaries, and marks every session that read the memory as holding memories that are gone (-1), so it reads the memory again. */
      clear: () => clearMemories(),
    },
    whatsapp: openWhatsappStore(db),
    close: () => db.close(),
  }
}

export type FirminoDatabase = ReturnType<typeof openDatabase>
