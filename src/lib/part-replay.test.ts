// End-to-end pin for the replay bug: run the real sessions store, apply a
// transcript snapshot (what the app fetches when it returns from the
// background), then deliver the older buffered delta the socket still had.
// The complete answer must stay on screen.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"
import { createStore } from "zustand/vanilla"
import { createPartBatcher } from "./part-batch.ts"
import { shouldApplyPartUpdate } from "./part-order.ts"

const SESSION = "s1"
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function harness() {
  const client = { session: { list: async () => [], create: async () => null, delete: async () => {} } }
  const connections = createStore(() => ({
    activeConnection: { id: "a", url: "https://a.example" },
    client,
    clientForDirectory: () => client,
  }))
  const source = fs.readFileSync(fileURLToPath(new URL("../stores/sessions.ts", import.meta.url).href), "utf8")
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports: Record<string, any> = {}
  const deps: Record<string, unknown> = {
    zustand: { create: createStore },
    "../lib/sdk": { ApiError: Error },
    "./connections": { useConnections: connections },
    "./settings": { useSettings: { getState: () => ({ pageSize: 25 }) } },
    "../lib/prompt-from-parts": { extractPromptFromParts: () => ({ text: "" }) },
    "../lib/message-merge": {
      mergeIncomingMessage: (messages: unknown[]) => messages,
      reconcileTemps: (_f: unknown, fetchedParts: unknown) => ({ messages: [], parts: fetchedParts }),
    },
    "../lib/session-load-reconcile": { isColdSessionLoad: () => true, isLiveEventForSession: () => true },
    "../lib/part-batch": { createPartBatcher },
    "../lib/part-order": { shouldApplyPartUpdate },
    "../lib/message-page": {
      countTurns: () => 1,
      messageLimitForTurns: () => 200,
      trimToTurns: (messages: unknown[]) => ({ messages, trimmed: false }),
    },
    "../lib/history-storage": { offlineHistory: { remove: async () => {} } },
  }
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => {
      assert.ok(name in deps, name)
      return deps[name]
    },
    console,
    setTimeout,
    clearTimeout,
  })
  return exports.useSessions
}

function seed(store: any, answer: string) {
  store.setState({
    currentSession: { id: SESSION, title: "replay" },
    messages: [{ id: "a1", sessionID: SESSION, role: "assistant", time: { created: 1 } }],
    parts: {
      a1: [{ id: "a1_text0", messageID: "a1", sessionID: SESSION, type: "text", text: answer }],
    },
  })
}

test("an older buffered delta cannot overwrite the transcript fetched on resume", async () => {
  const store = harness()
  seed(store, "Полный ответ, уже полученный, пока приложение было свёрнуто.")

  store.getState().handleEvent({
    type: "message.part.updated",
    properties: {
      part: { id: "a1_text0", messageID: "a1", sessionID: SESSION, type: "text", text: "Полный ответ" },
    },
  })
  await wait(80)

  assert.equal(
    store.getState().parts.a1[0].text,
    "Полный ответ, уже полученный, пока приложение было свёрнуто.",
    "the answer must not re-type itself from a stale backlog",
  )
})

test("live streaming still grows the bubble", async () => {
  const store = harness()
  seed(store, "Полный")

  store.getState().handleEvent({
    type: "message.part.updated",
    properties: {
      part: { id: "a1_text0", messageID: "a1", sessionID: SESSION, type: "text", text: "Полный ответ" },
    },
  })
  await wait(80)

  assert.equal(store.getState().parts.a1[0].text, "Полный ответ")
})
