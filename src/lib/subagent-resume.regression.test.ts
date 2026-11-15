import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const screen = fs.readFileSync(path.join(root, "app/session/[id].tsx"), "utf8")

test("returning from the background refreshes the subagent rows too", () => {
  const start = screen.indexOf('AppState.addEventListener("change"')
  assert.notEqual(start, -1, "the session screen must recover on foreground")
  const end = screen.indexOf("}, [sessionID, sessionClient])", start)
  assert.notEqual(end, -1, "the recovery effect must have its dependency list")
  const block = screen.slice(start, end)

  // The transcript refresh brings the subagent cards back, but their status
  // and title live in childrenByParent: without a reload a child that finished
  // while the app was backgrounded stays "Idle" until the session is reopened.
  assert.match(block, /refreshMessages\s*\(/)
  assert.match(block, /loadChildren\(sessionID\)/)
})
