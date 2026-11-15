import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"
import { createStore } from "zustand/vanilla"
import { keepLoadedHistory, messageLimitForTurns, trimToTurns } from "./message-page.ts"
import { reconcileTemps } from "./message-merge.ts"

const SESSION = "ses_refresh"

const row = (n: number) => ({
  info: { id: `m${String(n).padStart(3, "0")}`, sessionID: SESSION, role: "assistant", time: { created: n } },
  parts: [{ id: `p${n}`, messageID: `m${String(n).padStart(3, "0")}`, type: "text", text: `t${n}` }],
})

const history = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => row(from + i))

function harness(pageSize: number, previous: ReturnType<typeof history>) {
  const requests: Array<{ limit?: number } | undefined> = []
  let next: Promise<ReturnType<typeof history>> = Promise.resolve([])
  const client = {
    session: {
      messages: async (_id: string, params?: { limit?: number }) => {
        requests.push(params)
        return next
      },
      allMessages: async () => next,
    },
  }
  const connections = createStore(() => ({
    activeConnection: { id: "conn", url: "https://example.test" },
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
    "../lib/sdk": { ApiError: class ApiError extends Error {} },
    "./connections": { useConnections: connections },
    "./settings": { useSettings: { getState: () => ({ pageSize }) } },
    "../lib/prompt-from-parts": { extractPromptFromParts: () => ({ text: "" }) },
    "../lib/message-merge": { reconcileTemps },
    "../lib/session-load-reconcile": {
      isColdSessionLoad: () => false,
      isLiveEventForSession: () => true,
    },
    "../lib/part-batch": { createPartBatcher: () => ({ push: () => {}, dispose: () => {} }) },
    "../lib/part-order": { shouldApplyPartUpdate: () => true },
    "../lib/message-page": { keepLoadedHistory, messageLimitForTurns, trimToTurns, countTurns: () => 0, isWholeSession: () => false },
    "../lib/history-storage": { offlineHistory: { remove: async () => {} } },
    "../lib/keep-alive": { setKeepAlive: () => {} },
  }
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => {
      assert.ok(name in deps, name)
      return deps[name]
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
  })
  const store = exports.useSessions
  const parsed = {
    messages: previous.map((r) => r.info),
    parts: Object.fromEntries(previous.map((r) => [r.info.id, r.parts])),
  }
  store.setState({ currentSession: { id: SESSION, title: "refresh" }, ...parsed })
  return { store, requests, respond: (rows: ReturnType<typeof history>) => (next = Promise.resolve(rows)) }
}

test("a foreground refresh keeps the history already on screen", async () => {
  const h = harness(3, history(1, 120))
  // The server's default page is 50; the request must ask for the configured
  // page instead (3 prompts -> 60 messages) and keep the older 60 on screen.
  h.respond(history(61, 120))
  await h.store.getState().refreshMessages()
  assert.equal(h.requests[0]?.limit, 60)
  assert.deepEqual(
    h.store.getState().messages.map((m: { id: string }) => m.id),
    history(1, 120).map((r) => r.info.id),
    "older messages (and the subagent cards they carry) must survive a resume refresh",
  )
})

test("a resync page cannot replace the loaded transcript with its newest slice", () => {
  const h = harness(10, history(1, 120))
  h.store.getState().applyServerMessages(history(71, 120))
  assert.equal(h.store.getState().messages.length, 120)
})

test("a slow refresh for the previous session cannot overwrite the one now open", async () => {
  const h = harness(3, history(1, 120))
  h.respond(history(61, 120))
  const slow = h.store.getState().refreshMessages()
  h.store.setState({ currentSession: { id: "ses_other", title: "other" }, messages: [] })
  await slow
  assert.deepEqual(h.store.getState().messages, [], "another session's refresh must not land here")
})
