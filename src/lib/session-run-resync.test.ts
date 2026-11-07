import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { runInNewContext } from "node:vm"
import { isStreamStalled, shouldReconnectOnResume } from "./stream-watchdog.ts"
import { isSessionActuallyIdle } from "./session-status-reconcile.ts"
import { runsNeedingResync } from "./run-watchdog.ts"

const require = createRequire(import.meta.url)
const ts = require("typescript")

const SESSION = "ses_1"
const COMPLETED_TRANSCRIPT = [
  { info: { id: "u1", sessionID: SESSION, role: "user", time: { created: 1 } }, parts: [] },
  { info: { id: "a1", sessionID: SESSION, role: "assistant", time: { created: 2, completed: 9 } }, parts: [] },
]

/**
 * Run the real events store with a real SSE loop shape and fake time.
 * The stream stays open and keeps sending heartbeats (so `isStreamStalled`
 * never fires), which is exactly the reported failure: the socket is fine,
 * the session's events are not.
 */
function harness() {
  let now = 1_000_000
  let nextTimerID = 1
  const timers: Array<{ id: number; fn: () => void; due: number; period?: number; active: boolean }> = []

  const schedule = (fn: () => void, ms: number, period?: number) => {
    const id = nextTimerID++
    timers.push({ id, fn, due: now + ms, period, active: true })
    return id
  }

  // Controllable SSE source: `push()` delivers one event, `heartbeat()` wakes
  // the sdk's onActivity callback without ever yielding an event, `fail()`
  // rejects the pending read the way a dropped mobile socket does.
  let pending: ((value: { done: boolean; value?: unknown }) => void) | null = null
  let pendingReject: ((error: Error) => void) | null = null
  const queue: unknown[] = []
  const sse = {
    push(event: unknown) {
      if (pending) {
        const resolve = pending
        pending = null
        pendingReject = null
        resolve({ done: false, value: event })
      } else queue.push(event)
    },
    fail(error: Error) {
      if (!pendingReject) return
      const reject = pendingReject
      pending = null
      pendingReject = null
      // A dead socket cannot report activity; the next connect installs a new
      // onActivity callback.
      onActivity = null
      reject(error)
    },
    next(): Promise<{ done: boolean; value?: unknown }> {
      if (queue.length) return Promise.resolve({ done: false, value: queue.shift() })
      return new Promise((resolve, reject) => {
        pending = resolve
        pendingReject = reject
      })
    },
  }

  const stats = { messageCalls: 0, pendingCalls: 0, refreshCalls: 0, applied: 0, streams: 0, handled: [] as string[] }
  // Transcript the fake server returns. `null` means "run still in progress".
  let transcript: Array<{ info: Record<string, unknown>; parts: unknown[] }> | null = COMPLETED_TRANSCRIPT
  let failWith: { status: number } | null = null
  let onActivity: (() => void) | null = null
  // GET /api/session/active: "ses_1" running. A missing session is inactive.
  let activeIDs: string[] = []
  let failActive: { status: number } | null = null

  const client = {
    session: {
      messages: async () => {
        stats.messageCalls++
        if (failWith) throw failWith
        return transcript
      },
      active: async () => {
        if (failActive) throw failActive
        return activeIDs
      },
    },
    permission: {
      list: async () => {
        stats.pendingCalls++
        return []
      },
    },
    question: {
      list: async () => {
        stats.pendingCalls++
        return []
      },
    },
    global: {
      events: async function* (signal: AbortSignal, activity?: () => void) {
        stats.streams++
        onActivity = activity ?? null
        while (!signal.aborted) {
          const item = await sse.next()
          if (item.done) return
          onActivity?.()
          if (item.value) yield item.value
        }
      },
    },
  }

  const makeStore = <T,>(initializer: (set: any, get: any, api: any) => T) => {
    let state: T
    const listeners = new Set<(s: T) => void>()
    const setState = (partial: any, replace = false) => {
      const next = typeof partial === "function" ? partial(state) : partial
      state = replace ? next : { ...(state as object), ...next } as T
      for (const listener of listeners) listener(state)
    }
    const getState = () => state
    const api = { setState, getState, subscribe: (l: (s: T) => void) => (listeners.add(l), () => listeners.delete(l)) }
    state = initializer(setState, getState, api)
    return Object.assign(() => state, api)
  }

  const sessions = makeStore<any>(() => ({
    sessions: [],
    currentSession: { id: SESSION, title: "incident" },
    messages: [],
    parts: {},
    sending: {},
    refreshMessages: async () => {
      stats.refreshCalls++
    },
    applyServerMessages: () => {
      stats.applied++
    },
    handleEvent: (event: { type: string }) => {
      stats.handled.push(event.type)
    },
  }))

  const modules: Record<string, unknown> = {
    zustand: { create: makeStore },
    "./connections": {
      useConnections: {
        getState: () => ({ client, clientForDirectory: () => client, activeConnection: { id: "conn" } }),
        subscribe: () => () => {},
      },
    },
    "./sessions": { useSessions: sessions, abortedSessions: new Set<string>() },
    "../lib/notifications": { send: () => {} },
    "../lib/notify-format": { sanitizeBody: (_title: unknown, fallback: string) => fallback, PERMISSION_NOTIFICATION_KEY: "permission", QUESTION_NOTIFICATION_KEY: "question" },
    "../lib/i18n/config": { default: { t: (key: string) => key } },
    "../lib/status-labels": { statusFromPart: () => "" },
    "../lib/api-error": { isAuthError: () => false },
    "../lib/session-status-reconcile": { isSessionActuallyIdle },
    "../lib/stream-watchdog": { isStreamStalled, shouldReconnectOnResume },
    "../lib/run-watchdog": { runsNeedingResync },
    "../lib/pending-questions": { reconcilePendingQuestions: (local: unknown) => local },
    "../lib/answered-questions": { recordAnswered: (list: unknown) => list },
  }

  const source = readFileSync(fileURLToPath(new URL("../stores/events.ts", import.meta.url).href), "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText

  const exports: Record<string, any> = {}
  runInNewContext(output, {
    exports,
    module: { exports },
    require: (id: string) => {
      if (!(id in modules)) throw new Error(`Unexpected dependency ${id}`)
      return modules[id]
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    AbortController,
    Date: { now: () => now },
    Math,
    Promise,
    Object,
    Array,
    Set,
    Map,
    JSON,
    String,
    Boolean,
    Number,
    Error,
    setTimeout: (fn: () => void, ms: number) => schedule(fn, ms),
    clearTimeout: (id: number) => {
      const timer = timers.find((t) => t.id === id)
      if (timer) timer.active = false
    },
    setInterval: (fn: () => void, ms: number) => schedule(fn, ms, ms),
    clearInterval: (id: number) => {
      const timer = timers.find((t) => t.id === id)
      if (timer) timer.active = false
    },
  })

  const settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve))
  }

  // Heartbeats are scheduled on absolute time so advancing in small steps
  // still produces them at a fixed cadence (a per-call cadence would reset the
  // clock every step and never fire).
  let heartbeatEvery = 0
  let nextHeartbeat = Infinity

  const advance = async (ms: number) => {
    const target = now + ms
    while (now < target) {
      now = Math.min(now + 1000, target)
      for (const timer of [...timers]) {
        if (!timer.active || timer.due > now) continue
        if (timer.period) timer.due += timer.period
        else timer.active = false
        timer.fn()
      }
      if (now >= nextHeartbeat) {
        nextHeartbeat += heartbeatEvery
        onActivity?.()
      }
      await settle()
    }
  }

  return {
    events: exports.useEvents,
    sessions,
    stats,
    connect: () => exports.useEvents.getState().connect(),
    resume: (backgroundedForMs: number) =>
      exports.useEvents.getState().resumeFromBackground(backgroundedForMs),
    push: (event: unknown) => {
      sse.push(event)
      return settle()
    },
    advance,
    settle,
    heartbeatEvery(ms: number) {
      heartbeatEvery = ms
      nextHeartbeat = now + ms
    },
    setTranscript(next: typeof transcript) {
      transcript = next
    },
    failNextFetch(error: { status: number } | null) {
      failWith = error
    },
    setActive(ids: string[]) {
      activeIDs = ids
    },
    failActiveFetch(error: { status: number } | null) {
      failActive = error
    },
    breakStream() {
      sse.fail(new Error("socket closed"))
      return settle()
    },
    setBusy: () => {
      sessions.setState({ sending: { [SESSION]: true } })
    },
    now: () => now,
  }
}

const busyEvent = {
  type: "session.status",
  properties: { sessionID: SESSION, status: { type: "busy" } },
}

test("a run whose events are lost still shows the answer without reopening the session", async () => {
  const app = harness()
  app.heartbeatEvery(15_000)
  app.setBusy()
  app.connect()
  await app.settle()
  await app.push(busyEvent)
  assert.equal(app.events.getState().sessionStatus[SESSION].type, "busy")

  // 45s of a healthy socket (heartbeats) with zero events for this session.
  await app.advance(45_000)

  assert.equal(app.events.getState().connected, true, "socket stayed up — the stream watchdog cannot help")
  assert.equal(app.stats.messageCalls, 1, "one transcript fetch — not one to check plus one to display")
  assert.equal(app.events.getState().sessionStatus[SESSION].type, "idle")
  assert.equal(app.sessions.getState().sending[SESSION], false)
  assert.equal(app.stats.applied, 1, "the already-fetched transcript is applied, not re-requested")
})

test("a run that is still working shows its partial answer and stays busy", async () => {
  const app = harness()
  app.heartbeatEvery(15_000)
  app.setActive([SESSION])
  app.setTranscript([
    { info: { id: "u1", sessionID: SESSION, role: "user", time: { created: 1 } }, parts: [] },
    { info: { id: "a1", sessionID: SESSION, role: "assistant", time: { created: 2 } }, parts: [] },
  ])
  app.setBusy()
  app.connect()
  await app.settle()
  await app.push(busyEvent)

  await app.advance(30_000)

  assert.ok(app.stats.messageCalls >= 1)
  assert.ok(app.stats.applied >= 1, "partial output must reach the screen")
  assert.equal(app.events.getState().sessionStatus[SESSION].type, "busy", "the server still runs")
  assert.equal(app.sessions.getState().sending[SESSION], true)
})

test("a recovered run does not fast-forward the next one", async () => {
  const app = harness()
  app.heartbeatEvery(15_000)
  app.setBusy()
  app.connect()
  await app.settle()
  await app.push(busyEvent)
  await app.advance(20_000)
  assert.equal(app.events.getState().sessionStatus[SESSION].type, "idle")

  // Next send, again with no events at all: its own quiet window must start now.
  app.setBusy()
  await app.advance(5_000)
  assert.equal(app.stats.messageCalls, 1, "no immediate resync from the previous run's stale clock")

  await app.advance(20_000)
  assert.ok(app.stats.messageCalls > 1, "the new run is still watched")
})

test("a session deleted elsewhere stops being polled", async () => {
  const app = harness()
  app.heartbeatEvery(15_000)
  app.failNextFetch({ status: 404 })
  app.setBusy()
  app.connect()
  await app.settle()
  await app.push(busyEvent)

  await app.advance(40_000)
  const calls = app.stats.messageCalls
  assert.equal(calls, 1)
  assert.equal(app.events.getState().sessionStatus[SESSION].type, "idle")
  assert.equal(app.sessions.getState().sending[SESSION], false)

  await app.advance(60_000)
  assert.equal(app.stats.messageCalls, calls, "a 404 is terminal, not retried forever")
})

test("a run that keeps emitting events is never re-fetched", async () => {
  const app = harness()
  app.heartbeatEvery(15_000)
  app.setBusy()
  app.connect()
  await app.settle()
  await app.push(busyEvent)

  for (let i = 0; i < 9; i++) {
    await app.advance(5_000)
    await app.push({
      type: "message.part.updated",
      properties: { part: { id: "a1_text0", sessionID: SESSION, messageID: "a1", type: "text", text: "…" } },
    })
  }

  assert.equal(app.stats.messageCalls, 0)
  assert.equal(app.events.getState().sessionStatus[SESSION].type, "busy")
})

test("a long silent run is re-checked, not hammered every tick", async () => {
  const app = harness()
  app.heartbeatEvery(15_000)
  app.setBusy()
  app.connect()
  await app.settle()
  await app.push(busyEvent)

  await app.advance(120_000)

  assert.ok(app.stats.messageCalls >= 1, "expected at least one resync")
  assert.ok(app.stats.messageCalls <= 10, `expected rate-limited resyncs, saw ${app.stats.messageCalls}`)
})

test("an idle session is never re-fetched", async () => {
  const app = harness()
  app.heartbeatEvery(15_000)
  app.connect()
  await app.settle()
  await app.advance(120_000)

  assert.equal(app.stats.messageCalls, 0)
})

test("a completed run stops the watchdog so it cannot resurrect the spinner", async () => {
  const app = harness()
  app.heartbeatEvery(15_000)
  app.setBusy()
  app.connect()
  await app.settle()
  await app.push(busyEvent)
  await app.advance(20_000)

  const callsAfterIdle = app.stats.messageCalls
  await app.advance(60_000)
  assert.equal(app.stats.messageCalls, callsAfterIdle, "no further transcript fetches once the run is over")
})

test("a run the server no longer executes stops blocking the session", async () => {
  const app = harness()
  app.heartbeatEvery(15_000)
  // A run cancelled server-side (network loss, process restart) leaves the
  // transcript ending with the user's prompt: no assistant reply, no error.
  // The transcript tail alone cannot tell that from "model still thinking",
  // so the client used to keep the spinner and the sending flag forever.
  app.setTranscript([{ info: { id: "u1", sessionID: SESSION, role: "user", time: { created: 1 } }, parts: [] }])
  app.setBusy()
  app.connect()
  await app.settle()
  await app.push(busyEvent)

  await app.advance(30_000)

  assert.equal(app.events.getState().sessionStatus[SESSION].type, "idle")
  assert.equal(app.sessions.getState().sending[SESSION], false, "the composer must be usable again")
})

test("a session the server still runs stays busy even before its next event", async () => {
  const app = harness()
  app.heartbeatEvery(15_000)
  app.setActive([SESSION])
  app.setBusy()
  app.connect()
  await app.settle()
  await app.push(busyEvent)

  await app.advance(40_000)

  assert.equal(app.events.getState().sessionStatus[SESSION].type, "busy")
  assert.equal(app.sessions.getState().sending[SESSION], true)
})

test("an older server without the active list still closes a finished run", async () => {
  const app = harness()
  app.heartbeatEvery(15_000)
  app.failActiveFetch({ status: 404 })
  app.setBusy()
  app.connect()
  await app.settle()
  await app.push(busyEvent)

  await app.advance(30_000)

  assert.equal(app.events.getState().sessionStatus[SESSION].type, "idle")
  assert.equal(app.sessions.getState().sending[SESSION], false)
})

test("a reconnect resyncs the open session even when the server has nothing to say", async () => {
  const app = harness()
  app.heartbeatEvery(15_000)
  app.connect()
  await app.settle()
  assert.equal(app.stats.refreshCalls, 0)

  await app.breakStream()
  await app.advance(60_000)

  assert.equal(app.events.getState().connected, true)
  // Heartbeats never reach the event loop, so a resync gated on the first
  // parsed event would never run: the client would stay stale after a drop
  // whose busy -> idle transition happened while it was offline.
  assert.ok(app.stats.refreshCalls >= 1, "a reconnected stream catches up on its own")
})

test("returning from a long background replaces a socket the OS may have killed", async () => {
  const app = harness()
  app.heartbeatEvery(15_000)
  app.connect()
  await app.settle()
  assert.equal(app.stats.streams, 1)
  assert.equal(app.stats.refreshCalls, 0, "a healthy socket is trusted")

  app.resume(10 * 60_000)
  await app.settle()

  assert.equal(app.stats.streams, 2, "the suspended socket is replaced, not trusted")
  await app.advance(20_000)
  assert.ok(app.stats.refreshCalls >= 1, "the open session catches up after the gap")
})

test("a quick app switch keeps the stream and costs no reconnect", async () => {
  const app = harness()
  app.heartbeatEvery(15_000)
  app.connect()
  await app.settle()

  app.resume(3_000)
  await app.settle()

  assert.equal(app.stats.streams, 1)
})
