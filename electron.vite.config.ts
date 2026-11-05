import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"

const resolve = { alias: { "@src": fileURLToPath(new URL("src", import.meta.url)) } }

// Main and preload bundle their dependencies, so the packaged app ships no node_modules.
const bundled = externalizeDepsPlugin({ exclude: ["zod", "@orpc/client"] })

export default defineConfig({
  main: { resolve, plugins: [bundled] },
  preload: {
    resolve,
    plugins: [bundled],
    build: {
      rollupOptions: {
        input: { index: fileURLToPath(new URL("src/preload/index.ts", import.meta.url)) },
        external: ["electron"],
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    resolve,
    plugins: [tailwindcss(), react()],
    server: { host: "127.0.0.1", port: 5175 },
  },
})
