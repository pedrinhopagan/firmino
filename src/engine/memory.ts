import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { KolegaDatabase } from "./database"

/** One memory: a single line the agent recorded, with its local date. Its id is its position in the log, from 0. */
export interface StoredMemory {
  id: number
  date: string
  text: string
}

/** Memories lo through hi - 1. A block is an aligned power-of-two range, summarized in one line from its two halves. */
type Block = [lo: number, hi: number]

/** How many lines the memory document shows, about 8k tokens. */
const documentLines = 96
/** The longest memory or summary. */
const entryChars = 280
/** Blocks up to this size are summarized from their memories; bigger ones from their two halves. */
const rawMax = 16
/** The most a recall returns, so a vague pattern still fits the provider's tool output. */
const recallChars = 20_000

const entry = z.string().trim().min(1).max(entryChars).regex(/^[^\r\n]*$/, "One line only: merge them, or note them separately.")

function line(memory: StoredMemory) {
  return `#${memory.id} ${memory.date} ${memory.text}`
}

function blockId([lo, hi]: Block) {
  return `${lo}-${hi - 1}`
}

/** Parses "lo-hi" as the document prints it, inclusive at both ends, into a real block. */
function parseBlock(id: string): Block {
  const match = /^(\d+)-(\d+)$/.exec(id)
  const lo = Number(match?.[1])
  const hi = Number(match?.[2]) + 1
  const size = hi - lo

  if (!match || size < 2 || (size & (size - 1)) !== 0 || lo % size !== 0) {
    throw new Error(`${id} is not a block. Copy an id the memory document prints, like 16-31.`)
  }

  return [lo, hi]
}

function halves([lo, hi]: Block): [Block, Block] {
  const mid = (lo + hi) / 2

  return [[lo, mid], [mid, hi]]
}

/** Tiles memories [lo, count) of the block [lo, hi), keeping a block whole when its size is at most `alpha` times its age. */
function tile(block: Block, count: number, alpha: number): Block[] {
  const [lo, hi] = block

  if (lo >= count) {
    return []
  }

  if (hi - lo > 1 && (hi > count || hi - lo > alpha * (count - lo))) {
    return halves(block).flatMap((half) => tile(half, count, alpha))
  }

  return [block]
}

/** The blocks the memory document shows: at most `documentLines`, finest near the newest memory, so detail decays with age. */
function cover(count: number) {
  if (count <= documentLines) {
    return Array.from({ length: count }, (_, id): Block => [id, id + 1])
  }

  const root: Block = [0, 2 ** Math.ceil(Math.log2(count))]
  let fine = 0
  let coarse = 1

  for (let step = 0; step < 60; step++) {
    const alpha = (fine + coarse) / 2

    if (tile(root, count, alpha).length > documentLines) {
      fine = alpha
    } else {
      coarse = alpha
    }
  }

  const blocks = tile(root, count, coarse)

  // Block sizes jump in powers of two, so alpha alone can undershoot the budget. The lines left go to the newest blocks.
  while (blocks.length < documentLines) {
    const index = blocks.findLastIndex(([lo, hi]) => hi - lo > 1)
    const block = blocks[index]

    if (!block) {
      break
    }

    blocks.splice(index, 1, ...halves(block))
  }

  return blocks
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] }
}

/**
 * Kolega's permanent memory, after OptMem (github.com/VictorTaelin/OptMem): an append-only log of one-line memories and a binary tree of one-line summaries over it.
 * The agent records and compresses memories through its MCP tools; each provider session reads the memory document when the memory changed since it last read it.
 */
export class Memory {
  constructor(private readonly database: KolegaDatabase) {}

  /**
   * What a turn on the provider session `thread` carries about the memory: the memory document, when the session has not read the current memory.
   * Once the turn ends, `read` takes the session the turn ran on; the session read the memory when the turn carried it, or when it is the same session and already had.
   */
  forTurn(thread?: string) {
    const count = this.database.memories.count()
    const read = thread ? Number(this.database.state.get(`memory.read.${thread}`) ?? 0) : 0
    const document = count > read ? this.document(count) : undefined

    return {
      document,
      read: (after: string) => {
        if (document || after === thread) {
          this.database.state.set(`memory.read.${after}`, String(this.database.memories.count()))
        }
      },
    }
  }

  registerTools(server: McpServer) {
    server.registerTool("memory_note", {
      description: `Record one memory in your permanent memory: one line of at most ${entryChars} characters. Returns its id and, when one came due, a compression to do with memory_nap before your next action.`,
      inputSchema: { text: entry.describe("The memory, one dense line in the user's language.") },
    }, (input) => {
      const id = this.database.memories.append({ date: new Date().toLocaleDateString("sv-SE"), text: input.text })

      return text([`Saved as #${id}.`, this.compression(id + 1)].filter(Boolean).join("\n\n"))
    })
    server.registerTool("memory_nap", {
      description: "Save the compression memory_note or the memory document asked for. Blocks are compressed in order, one at a time.",
      inputSchema: {
        block: z.string().describe("The block id the compression names, like \"0-1\"."),
        summary: entry.describe("The compressed line: what has lasting effect, nothing invented."),
      },
    }, (input) => text(this.nap(input.block, input.summary)))
    server.registerTool("memory_recall", {
      description: "Search every memory ever recorded, word for word, newest matches last.",
      inputSchema: { pattern: z.string().min(1).describe("A case-insensitive JavaScript regular expression.") },
    }, (input) => text(this.recall(new RegExp(input.pattern, "i"))))
    server.registerTool("memory_zoom", {
      description: "Open a #lo-hi line of the memory into its two halves, each a summary or, once single, the memory itself.",
      inputSchema: { block: z.string().describe("A block id from the memory, like \"16-31\".") },
    }, (input) => text(this.zoom(parseBlock(input.block))))
  }

  private document(count: number) {
    const compression = this.compression(count)

    return [
      `Sua memória, da mais antiga para a mais recente (${count} ${count === 1 ? "memória" : "memórias"}):`,
      cover(count).flatMap((block) => this.render(block)).join("\n"),
      compression && `Antes de continuar, faça esta compressão pendente:\n\n${compression}`,
    ].filter(Boolean).join("\n\n")
  }

  /** One block as document lines: its memory or summary. A summary not written yet shows its halves, so the document stays whole until the agent compresses it. */
  private render(block: Block): string[] {
    const [lo, hi] = block

    if (hi - lo === 1) {
      return this.database.memories.range(lo, hi).map(line)
    }

    const summary = this.database.memories.summary(lo, hi - lo)

    if (summary) {
      return [`#${blockId(block)} ${summary}`]
    }

    return halves(block).flatMap((half) => this.render(half))
  }

  /** The next block to compress and how many follow it. Each level is summarized in order, so its count says how far it got. */
  private pending(count: number) {
    let next: Block | undefined
    let total = 0

    for (let size = 2; size <= count; size *= 2) {
      const done = this.database.memories.summaries(size)
      const missing = Math.floor(count / size) - done

      if (missing > 0) {
        next ??= [done * size, (done + 1) * size]
        total += missing
      }
    }

    return next && { block: next, after: total - 1 }
  }

  /** The prompt for the next compression the first `count` memories need. */
  private compression(count: number) {
    const pending = this.pending(count)

    if (!pending) {
      return undefined
    }

    const [lo, hi] = pending.block
    const body = hi - lo <= rawMax ? this.database.memories.range(lo, hi).map(line) : halves(pending.block).map((half) => `#${blockId(half)} ${this.summary(half)}`)
    const left = pending.after === 1 ? "1 compression remains after this one." : `${pending.after} compressions remain after this one.`

    return [
      `Compress memories #${blockId(pending.block)} into one line of at most ${entryChars} characters.\nKeep what has lasting effect, drop what does not. Invent nothing.`,
      body.map((item) => `  ${item}`).join("\n"),
      ...(pending.after > 0 ? [left] : []),
      `Call memory_nap with block "${blockId(pending.block)}" and your line.`,
    ].join("\n\n")
  }

  private summary(block: Block) {
    const summary = this.database.memories.summary(block[0], block[1] - block[0])

    // A level is only compressed after the level below it, so both halves of a pending block exist.
    if (!summary) {
      throw new Error(`The summary of #${blockId(block)} is missing.`)
    }

    return summary
  }

  private nap(id: string, summary: string) {
    const count = this.database.memories.count()
    const pending = this.pending(count)

    if (!pending) {
      return "Nothing left to compress."
    }

    const next = blockId(pending.block)

    if (id !== next) {
      const [lo, hi] = parseBlock(id)

      if (!this.database.memories.summary(lo, hi - lo)) {
        throw new Error(`Wrong block: ${id}. Blocks are compressed in order; the next is ${next}.`)
      }

      return [`${id} is already settled.`, this.compression(count)].join("\n\n")
    }

    this.database.memories.summarize(pending.block[0], pending.block[1] - pending.block[0], summary)

    return [`${id} saved.`, this.compression(count) ?? "Nothing left to compress."].join("\n\n")
  }

  private recall(pattern: RegExp) {
    const matches = this.database.memories.all().map(line).filter((item) => pattern.test(item))

    if (matches.length === 0) {
      return "No match."
    }

    const newest: string[] = []
    let size = 0

    for (const item of matches.toReversed()) {
      size += item.length + 1

      if (size > recallChars) {
        break
      }

      newest.unshift(item)
    }

    if (newest.length < matches.length) {
      return `${newest.join("\n")}\nNewest ${newest.length} of ${matches.length} matches. Narrow the pattern.`
    }

    return `${newest.join("\n")}\n${matches.length} ${matches.length === 1 ? "match" : "matches"}.`
  }

  private zoom(block: Block) {
    const count = this.database.memories.count()

    if (block[0] >= count) {
      throw new Error(`#${blockId(block)} is beyond the memory: it holds ${count} memories.`)
    }

    return halves(block).filter(([lo]) => lo < count).flatMap((half) => this.render(half)).join("\n")
  }
}
