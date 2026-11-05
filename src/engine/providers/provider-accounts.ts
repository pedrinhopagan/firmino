import { readFileSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve, sep } from "node:path"
import { ORPCError } from "@orpc/server"
import { z } from "zod"
import { type NewProviderAccount, type ProviderAccount, providerAccount, type ProviderId, type ProviderStatus } from "@src/shared/conversation"
import { parse } from "@src/shared/parse"
import type { KolegaDatabase } from "../database"
import { adoptLoginShellPath } from "../login-shell-path"
import type { Observability } from "../observability"
import { claudeLogin, claudeStatus } from "./claude"
import { codexLogin, codexStatus } from "./codex"
import type { ProviderLaunch, ProviderLogin } from "./provider"

const drivers = {
  codex: { name: "Codex", binary: "codex", home: { variable: "CODEX_HOME", folder: ".codex" }, status: codexStatus, login: codexLogin },
  claude: { name: "Claude", binary: "claude", home: { variable: "CLAUDE_CONFIG_DIR", folder: ".claude" }, status: claudeStatus, login: claudeLogin },
} satisfies Record<ProviderId, unknown>

/** The account each provider starts with: the CLI's own home, the one a terminal uses. */
const defaultAccounts: ProviderAccount[] = [
  { id: "codex", provider: "codex", name: "Codex", enabled: true },
  { id: "claude", provider: "claude", name: "Claude", enabled: true },
]
const defaultIds = new Set(defaultAccounts.map((account) => account.id))

const storedAccounts = z.array(providerAccount)

const t3Path = (value?: string) => value?.trim().replace(/^~(?=$|\/)/, homedir()) || undefined
/** T3 Code's provider instances, as its settings.json saves them. */
const t3Settings = z.object({
  providerInstances: z.record(z.string(), z.object({
    driver: z.string(),
    displayName: z.string().optional(),
    enabled: z.boolean().default(true),
    config: z.object({ setupMode: z.string().optional(), binaryPath: z.string().optional(), homePath: z.string().optional(), shadowHomePath: z.string().optional() }).default({}),
  })).default({}),
})
const t3Drivers: Record<string, ProviderId> = { codex: "codex", claudeAgent: "claude" }
/** T3 Code's default instances are Kolega's default accounts: the same home. */
const t3DefaultIds: Record<string, string> = { codex: "codex", claudeAgent: "claude" }

/** The Codex and Claude accounts T3 Code has; none when T3 Code is not installed. */
function readT3Accounts() {
  const file = join(t3Path(process.env.T3CODE_HOME) ?? join(homedir(), ".t3"), "userdata", "settings.json")
  const text = (() => {
    try {
      return readFileSync(file, "utf8")
    } catch {
      return undefined
    }
  })()

  if (!text) {
    return []
  }

  const settings = t3Settings.safeParse(JSON.parse(text))

  if (!settings.success) {
    return []
  }

  return Object.entries(settings.data.providerInstances).flatMap(([id, instance]): ProviderAccount[] => {
    const provider = t3Drivers[instance.driver]

    // A managed instance signs in with T3 Code's own ChatGPT client; its tokens never reach a home the Codex CLI reads.
    if (!provider || instance.config.setupMode === "managed") {
      return []
    }

    // A shadow home holds the instance's own auth.json and links the rest to its shared home.
    const home = t3Path(instance.config.shadowHomePath) ?? t3Path(instance.config.homePath)
    const binary = t3Path(instance.config.binaryPath)

    return [{
      id: t3DefaultIds[id] ?? id,
      provider,
      name: instance.displayName?.trim() || drivers[provider].name,
      ...(home ? { home: resolve(home) } : {}),
      ...(binary ? { binary } : {}),
      enabled: instance.enabled,
    }]
  })
}

function effectiveHome(account: Pick<ProviderAccount, "provider" | "home">) {
  return account.home ?? join(homedir(), drivers[account.provider].home.folder)
}

/** Adds the incoming accounts and updates the ones that share an id or a home with them. */
function merged(current: ProviderAccount[], incoming: ProviderAccount[]) {
  return incoming.reduce((accounts, account) => {
    const same = accounts.findIndex((known) => known.id === account.id || (known.provider === account.provider && effectiveHome(known) === effectiveHome(account)))

    if (same === -1) {
      return [...accounts, account]
    }

    return accounts.with(same, { ...account, id: accounts[same]?.id ?? account.id })
  }, current)
}

/**
 * The provider accounts Kolega can answer with, as T3 Code's provider instances: each one is a provider CLI pointed at its own home.
 * It owns the saved list, the launch of each account's CLI, its status and its sign-in.
 */
export class ProviderAccounts {
  private path?: Promise<void>
  private readonly logins = new Map<string, ProviderLogin>()
  private readonly managedRoot: string

  constructor(private readonly database: KolegaDatabase, private readonly observability: Observability, dataDirectory: string, private readonly openPage: (url: string) => void) {
    this.managedRoot = join(dataDirectory, "providers")
  }

  /** Adopts the login shell's PATH once, so the CLIs resolve as they do in a terminal. Call it before `launch`. */
  async ready() {
    this.path ??= this.observability.span({ name: "engine.loginshellpath" }, () => adoptLoginShellPath())
    await this.path
  }

  list() {
    const stored = this.database.state.get("accounts")

    if (stored) {
      return parse(storedAccounts, JSON.parse(stored))
    }

    return this.save(merged(defaultAccounts, readT3Accounts()))
  }

  /** A new account in a home folder Kolega creates, unless the user points it at an existing home. */
  async add(input: NewProviderAccount) {
    const id = `${input.provider}-${crypto.randomUUID().slice(0, 8)}`
    const home = input.home ? resolve(t3Path(input.home) ?? input.home) : join(this.managedRoot, input.provider, id)
    await mkdir(home, { recursive: true })
    const account: ProviderAccount = { id, provider: input.provider, name: input.name, home, enabled: true }
    this.save([...this.list(), account])

    return account
  }

  update(input: Pick<ProviderAccount, "id" | "name" | "enabled">) {
    const account = { ...this.get(input.id), name: input.name, enabled: input.enabled }
    this.save(this.list().map((known) => (known.id === account.id ? account : known)))

    return account
  }

  /** Forgets the account; a home Kolega created goes with it, a home the user pointed at stays. */
  async remove(id: string) {
    const account = this.get(id)

    if (defaultIds.has(id)) {
      throw new ORPCError("BAD_REQUEST", { message: "A conta padrão não pode ser removida. Desative-a." })
    }

    this.logins.get(id)?.cancel()
    this.save(this.list().filter((known) => known.id !== id))

    if (account.home?.startsWith(this.managedRoot + sep)) {
      await rm(account.home, { recursive: true, force: true })
    }
  }

  importT3() {
    return this.save(merged(this.list(), readT3Accounts()))
  }

  /** How to start the account's CLI; throws when the account is off or its CLI is missing. */
  launch(id: string) {
    const account = this.get(id)
    const executable = this.executable(account)

    if (!account.enabled) {
      throw new ORPCError("PRECONDITION_FAILED", { message: `A conta ${account.name} está desativada` })
    }

    if (!executable) {
      throw new ORPCError("PRECONDITION_FAILED", { message: `${drivers[account.provider].name} não está instalado` })
    }

    return { account, executable, env: this.env(account) }
  }

  async status() {
    await this.ready()

    return await Promise.all(this.list().map((account) => this.observability.span({ name: "provider.status", attributes: { provider: account.provider } }, () => this.accountStatus(account)).catch((): ProviderStatus => ({ account, installed: true, loggedIn: false, models: [] }))))
  }

  /** Opens the account's sign-in page, yields it, and returns once the CLI saved the login. Aborting cancels the sign-in. */
  async *login(id: string, signal?: AbortSignal) {
    await this.ready()
    const { account, ...launch } = this.launch(id)
    this.logins.get(id)?.cancel()
    const login = await drivers[account.provider].login(launch)
    this.logins.set(id, login)
    signal?.addEventListener("abort", login.cancel)

    try {
      this.openPage(login.url)
      yield { url: login.url }
      await login.done
      this.observability.event({ name: "provider.loggedin", attributes: { provider: account.provider } })
    } finally {
      signal?.removeEventListener("abort", login.cancel)
      login.cancel()

      if (this.logins.get(id) === login) {
        this.logins.delete(id)
      }
    }
  }

  loginCode(id: string, code: string) {
    const login = this.logins.get(id)

    if (!login?.submitCode) {
      throw new ORPCError("PRECONDITION_FAILED", { message: "Nenhum login do Claude em andamento nesta conta" })
    }

    login.submitCode(code)
  }

  private get(id: string) {
    const account = this.list().find((known) => known.id === id)

    if (!account) {
      throw new ORPCError("NOT_FOUND", { message: "Conta não encontrada" })
    }

    return account
  }

  private save(accounts: ProviderAccount[]) {
    this.database.state.set("accounts", JSON.stringify(accounts))

    return accounts
  }

  private executable(account: ProviderAccount) {
    return Bun.which(account.binary ?? drivers[account.provider].binary, { PATH: process.env.PATH ?? "" }) ?? undefined
  }

  private env(account: ProviderAccount): ProviderLaunch["env"] {
    if (!account.home) {
      return {}
    }

    return { [drivers[account.provider].home.variable]: account.home }
  }

  private async accountStatus(account: ProviderAccount): Promise<ProviderStatus> {
    const executable = this.executable(account)

    if (!account.enabled || !executable) {
      return { account, installed: !!executable, loggedIn: false, models: [] }
    }

    return { account, ...(await drivers[account.provider].status({ executable, env: this.env(account) })) }
  }
}
