import { parseArgs } from "node:util"
import { launchFirmino, spanStart } from "./app"

const { values } = parseArgs({ args: Bun.argv.slice(2), options: { "user-data": { type: "string", default: ".firmino-bench" }, rounds: { type: "string", default: "5" } } })
const results = []

for (let round = 0; round < Number(values.rounds); round += 1) {
  const app = await launchFirmino(values["user-data"])

  try {
    const firstRpc = await app.waitFor("renderer.rpc")
    const spans = await app.spans()
    const mainStartup = spans.find((span) => span.name === "main.startup")
    const engineStartup = spans.find((span) => span.name === "engine.startup")

    if (!mainStartup || !engineStartup) {
      throw new Error("The boot spans are missing")
    }

    results.push({
      mainStartFromSpawnMs: spanStart(mainStartup) - app.spawnedAt,
      mainStartupMs: Math.round(mainStartup.durationMs),
      engineStartupMs: Math.round(engineStartup.durationMs),
      firstRpcFromSpawnMs: spanStart(firstRpc) - app.spawnedAt,
    })
  } finally {
    await app.quit()
  }
}

console.table(results)
