import { BufferJSON, initAuthCreds, proto, type AuthenticationCreds, type AuthenticationState, type SignalDataTypeMap } from "baileys"

/** One Signal key as stored; a null value deletes it. */
export interface WhatsappKey {
  type: string
  id: string
  value: string | null
}

/** A linked account's saved auth: the creds blob and every Signal key on its own. */
export interface WhatsappSavedAuth {
  creds: string
  keys: { type: string; id: string; value: string }[]
}

type Keys = Record<string, Record<string, unknown>>

const encode = (value: unknown) => JSON.stringify(value, BufferJSON.replacer)
const decode = (value: string): unknown => JSON.parse(value, BufferJSON.reviver)

/** The Baileys auth state restored from `saved`; `changed` receives each batch of key writes Baileys makes. */
export function whatsappAuth(saved: WhatsappSavedAuth | undefined, changed: (keys: WhatsappKey[]) => void) {
  const creds = saved ? decode(saved.creds) as AuthenticationCreds : initAuthCreds()
  const keys: Keys = {}

  for (const key of saved?.keys ?? []) {
    const bucket = keys[key.type] ?? {}
    bucket[key.id] = decode(key.value)
    keys[key.type] = bucket
  }

  const state: AuthenticationState = {
    creds,
    keys: {
      get(type, ids) {
        const bucket = keys[type] ?? {}

        return Object.fromEntries(ids.flatMap((id) => {
          const value = bucket[id]

          if (value === undefined) {
            return []
          }

          return [[id, type === "app-state-sync-key" ? proto.Message.AppStateSyncKeyData.fromObject(value as object) : value]]
        })) as { [id: string]: SignalDataTypeMap[typeof type] }
      },
      set(data) {
        const written: WhatsappKey[] = []

        for (const [type, values] of Object.entries(data)) {
          const bucket = keys[type] ?? {}

          for (const [id, value] of Object.entries(values ?? {})) {
            if (value === null) {
              delete bucket[id]
            } else {
              bucket[id] = value
            }

            written.push({ type, id, value: value === null ? null : encode(value) })
          }

          keys[type] = bucket
        }

        changed(written)
      },
    },
  }

  return {
    state,
    creds: () => encode(creds),
    /** Every key held now, for the first write once the account links. */
    keys: () => Object.entries(keys).flatMap(([type, bucket]) => Object.entries(bucket).map(([id, value]) => ({ type, id, value: encode(value) }))),
  }
}
