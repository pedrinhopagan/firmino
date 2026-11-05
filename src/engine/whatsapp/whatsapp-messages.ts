import { getContentType, jidNormalizedUser, normalizeMessageContent, type WAMessage } from "baileys"
import type { WhatsappRow } from "./whatsapp-connection"

const systemKinds = new Set(["protocolMessage", "senderKeyDistributionMessage", "messageContextInfo", "placeholderMessage", "deviceSentMessage", "keepInChatMessage"])

const kindLabels: Record<string, string> = {
  albumMessage: "album",
  audioMessage: "audio",
  buttonsMessage: "buttons",
  buttonsResponseMessage: "button reply",
  contactMessage: "contact",
  contactsArrayMessage: "contacts",
  documentMessage: "document",
  documentWithCaptionMessage: "document",
  eventMessage: "event",
  imageMessage: "image",
  interactiveMessage: "interactive",
  interactiveResponseMessage: "interactive reply",
  listMessage: "list",
  listResponseMessage: "list reply",
  liveLocationMessage: "live location",
  locationMessage: "location",
  lottieStickerMessage: "sticker",
  pollCreationMessage: "poll",
  pollCreationMessageV2: "poll",
  pollCreationMessageV3: "poll",
  pollUpdateMessage: "poll vote",
  ptvMessage: "video note",
  ptcMessage: "voice note",
  questionMessage: "question",
  questionReplyMessage: "question reply",
  scheduledCallCreationMessage: "scheduled call",
  stickerMessage: "sticker",
  templateMessage: "template",
  videoMessage: "video",
}

function writtenText(content: ReturnType<typeof normalizeMessageContent>) {
  return content?.conversation ?? content?.extendedTextMessage?.text ?? content?.imageMessage?.caption ?? content?.videoMessage?.caption ?? content?.documentMessage?.caption
}

function textOf(message: WAMessage) {
  const content = normalizeMessageContent(message.message)
  const written = writtenText(content)

  if (written) {
    return written
  }

  const reaction = content?.reactionMessage?.text

  if (reaction) {
    return `[reacted ${reaction}]`
  }

  const kind = getContentType(content)

  if (!kind || systemKinds.has(kind)) {
    return ""
  }

  return `[${kindLabels[kind] ?? kind.replace(/Message(V\d)?$/, "")}]`
}

/** A LID and the phone-number jid it stands for, both without device. */
export interface WhatsappLid {
  lid: string
  pn: string
}

export function lidPair(first?: string | null, second?: string | null): WhatsappLid | undefined {
  const jids = [first, second].map((jid) => jidNormalizedUser(jid ?? ""))
  const lid = jids.find((jid) => jid.endsWith("@lid"))
  const pn = jids.find((jid) => jid.endsWith("@s.whatsapp.net"))

  if (!lid || !pn) {
    return undefined
  }

  return { lid, pn }
}

/** The one id Kolega keeps for a person: the phone-number jid when any source has mapped the LID, the LID until then. */
export function canonicalJid(jid: string | null | undefined, phones: Map<string, string>) {
  const normalized = jidNormalizedUser(jid ?? "")

  return phones.get(normalized) ?? normalized
}

/** The LID mappings a message carries in its alternate addressing. */
export function messageLids(message: WAMessage) {
  return [lidPair(message.key.remoteJid, message.key.remoteJidAlt), lidPair(message.key.participant, message.key.participantAlt)].flatMap((pair) => pair ?? [])
}

export function nameOf(contact: { name?: string | null; notify?: string | null; verifiedName?: string | null }) {
  return [contact.name, contact.verifiedName, contact.notify].find((candidate) => candidate?.trim()) ?? ""
}

/** The message as stored, under canonical ids; `phones` must already hold the message's own mappings. */
export function messageRow(message: WAMessage, names: Map<string, string>, phones: Map<string, string>): WhatsappRow | undefined {
  const chatId = canonicalJid(message.key.remoteJid, phones)
  const id = message.key.id
  const seconds = Number(message.messageTimestamp ?? 0)

  if (!chatId || !id || !seconds) {
    return undefined
  }

  const content = textOf(message)

  if (!content) {
    return undefined
  }

  const fromMe = message.key.fromMe === true
  const sender = fromMe ? "" : canonicalJid(message.key.participant ?? message.key.remoteJid, phones)

  return {
    id: `${chatId}:${id}`,
    chatId,
    senderName: fromMe ? "eu" : names.get(sender) || message.pushName || names.get(chatId) || sender,
    fromMe,
    content,
    sentAt: new Date(seconds * 1000).toISOString(),
  }
}
