import React from "react"
import ReactDOM from "react-dom/client"
import { App } from "./app"
import { createEngineClient } from "./engine-client"
import "./styles.css"

const root = document.getElementById("root")

if (!root) {
  throw new Error("Renderer root is missing")
}

const client = createEngineClient(await window.desktop.getEngineConnection())
const health = await client.health().catch(() => null)

ReactDOM.createRoot(root).render(<React.StrictMode><App health={health} /></React.StrictMode>)
