import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from "node:url"
import vm from 'node:vm'
import ts from 'typescript'
import { createStore } from 'zustand/vanilla'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function harness() {
  const pending = deferred<any>()
  const removed: string[] = []
  const client = { session: { list: () => pending.promise, create: () => pending.promise, delete: () => pending.promise } }
  const connections = createStore(() => ({ activeConnection: { id: 'a', url: 'https://a.example' }, client, clientForDirectory: () => client }))
  const source = fs.readFileSync(fileURLToPath(new URL('../stores/sessions.ts', import.meta.url).href), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports: Record<string, any> = {}
  const deps: Record<string, unknown> = {
    zustand: { create: createStore }, '../lib/sdk': { ApiError: Error }, './connections': { useConnections: connections },
    './settings': { useSettings: { getState: () => ({ pageSize: 25 }) } },
    '../lib/prompt-from-parts': { extractPromptFromParts: () => ({ text: '' }) },
    '../lib/message-merge': { mergeIncomingMessage: () => [], reconcileTemps: () => ({ messages: [], parts: {} }) },
    '../lib/session-load-reconcile': { isColdSessionLoad: () => true, isLiveEventForSession: () => true },
    '../lib/part-batch': { createPartBatcher: () => ({ push: () => {}, dispose: () => {} }) },
    '../lib/part-order': { shouldApplyPartUpdate: () => true },
    '../lib/message-page': {
      countTurns: () => 1,
      messageLimitForTurns: () => 200,
      trimToTurns: (messages: unknown[]) => ({ messages, trimmed: false }),
    },
    '../lib/history-storage': { offlineHistory: { remove: async (id: string) => { removed.push(id) } } },
    "../lib/keep-alive": { setKeepAlive: () => {} },
  }
  vm.runInNewContext(code, { exports, require: (name: string) => { assert.ok(name in deps, name); return deps[name] }, console, setTimeout, clearTimeout })
  return { store: exports.useSessions, pending, removed, change: () => connections.setState({ activeConnection: { id: 'b', url: 'https://b.example' } }) }
}
test('late session list from A cannot enter B', async () => {
  const h = harness(), loading = h.store.getState().loadSessions()
  h.change(); h.pending.resolve([{ id: 'a-private' }]); await loading
  assert.equal(h.store.getState().sessions.length, 0)
})
test('late session creation from A cannot become B current session or cache input', async () => {
  const h = harness(), creating = h.store.getState().createSession('Private A')
  h.change(); h.pending.resolve({ id: 'a-private' }); const result = await creating
  assert.equal(h.store.getState().currentSession, null)
  assert.equal(result, null, 'caller must not navigate to stale session')
})
test('delete keeps originating connection even if active server changes', async () => {
  const h = harness(), deleting = h.store.getState().deleteSession('same-id')
  h.change(); h.pending.resolve(true); await deleting
  assert.deepEqual(h.removed, ['a'])
})
