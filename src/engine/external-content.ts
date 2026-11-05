const tag = "conteudo_externo"

/**
 * Wraps text someone else wrote, such as a WhatsApp message, so the agent reads it as data.
 * A closing tag inside the text is defused, so the text cannot end the block early and pose as Kolega's own words.
 */
export function externalContent(source: string, text: string) {
  return `<${tag} origem="${source}">\n${text.replace(new RegExp(`</?${tag}`, "gi"), "[marca removida]")}\n</${tag}>`
}
