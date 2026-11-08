const startMarker = "__FIRMINO_PATH_START__"
const endMarker = "__FIRMINO_PATH_END__"
const shellTimeoutMs = 5_000

async function readPath(shell: string) {
  const child = Bun.spawn([shell, "-ilc", `printf '%s\\n' '${startMarker}'; printenv PATH; printf '%s\\n' '${endMarker}'`], { stdin: "ignore", stdout: "pipe", stderr: "ignore", detached: true })
  const { promise: expired, resolve: expire } = Promise.withResolvers<undefined>()
  const deadline = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch {
      child.kill("SIGKILL")
    }

    expire(undefined)
  }, shellTimeoutMs)
  const output = await Promise.race([new Response(child.stdout).text(), expired]).finally(() => clearTimeout(deadline))

  return output?.split(startMarker)[1]?.split(endMarker)[0]?.trim()
}

export async function adoptLoginShellPath() {
  if (process.platform === "win32") {
    return
  }

  const path = await readPath(process.env.SHELL || "/bin/bash").catch(() => undefined)

  if (path) {
    process.env.PATH = [...new Set([...path.split(":"), ...(process.env.PATH ?? "").split(":")])].filter(Boolean).join(":")
  }
}
