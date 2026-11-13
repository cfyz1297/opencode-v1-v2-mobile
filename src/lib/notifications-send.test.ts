// Why a real send() is exercised instead of a pure helper: the bug that
// survived the previous "fix" was not in a predicate but in the native call —
// `trigger: null` makes expo ignore the requested channel, and every early
// return in send() is silent by design. Running the real module against a fake
// expo-notifications is the only way to see which of those paths was taken.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { runInNewContext } from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")

function harness(
  options: {
    status?: string
    failSchedule?: boolean
    appState?: string
    /** Stand-in for the native Notify module, which posts per-category icons. */
    native?: boolean
    nativeFails?: boolean
  } = {},
) {
  const nativeCalls: Array<{ category: string; title: string; body: string; sessionId: string; channelId: string }> = []
  const scheduled: Array<{ title: string; body: string; trigger: unknown }> = []
  const logs: string[] = []
  const state = { status: options.status ?? "granted", appState: options.appState ?? "background" }
  const clock = { now: 1_000_000 }

  const Notifications = {
    AndroidImportance: { HIGH: 4 },
    setNotificationHandler: () => {},
    setNotificationChannelAsync: async () => {},
    getPermissionsAsync: async () => ({ status: state.status }),
    requestPermissionsAsync: async () => ({ status: state.status }),
    scheduleNotificationAsync: async (request: any) => {
      if (options.failSchedule) throw new Error("Notifications are not supported")
      scheduled.push({ ...request.content, trigger: request.trigger })
      return "id"
    },
    addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
    getLastNotificationResponseAsync: async () => null,
  }

  const modules: Record<string, unknown> = {
    "expo-notifications": Notifications,
    "expo-device": { isDevice: true },
    "react-native": {
      Platform: { OS: "android" },
      AppState: { currentState: state.appState },
      NativeModules: options.native
        ? {
            Notify: {
              notify: async (category: string, title: string, body: string, sessionId: string, channelId: string) => {
                if (options.nativeFails) throw new Error("notify_failed")
                nativeCalls.push({ category, title, body, sessionId, channelId })
                return true
              },
            },
          }
        : {},
    },
    "./logbuffer": {
      log: {
        debug: () => {},
        info: (_tag: string, ...parts: unknown[]) => logs.push(`info ${parts.join(" ")}`),
        warn: (_tag: string, ...parts: unknown[]) => logs.push(`warn ${parts.join(" ")}`),
        error: (_tag: string, ...parts: unknown[]) => logs.push(`error ${parts.join(" ")}`),
      },
    },
  }

  const source = readFileSync(fileURLToPath(new URL("./notifications.ts", import.meta.url).href), "utf8")
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
    Date: { now: () => clock.now },
    Map,
    Object,
    Promise,
    String,
    Error,
    JSON,
  })
  // Categories default to "completed off" — a test must not depend on that.
  exports.configure(() => ({
    permissions: true,
    questions: true,
    completed: true,
    errors: true,
    connection: true,
  }))
  return { exports, scheduled, nativeCalls, logs, state, clock }
}

test("a finished run reaches the shade while the app is in the background", async () => {
  const { exports, scheduled } = harness()
  await exports.send({
    category: "completed",
    title: "Task completed",
    body: "Session finished processing",
    sessionId: "ses_1",
  })
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].title, "Task completed")
})

test("nothing is posted over an open chat — the transcript already shows it", async () => {
  // Reported from the device: banners over an open chat are noise.
  const { exports, scheduled } = harness({ appState: "active" })
  for (const category of ["completed", "questions", "permissions", "errors"] as const) {
    await exports.send({ category, title: "t", body: "b", sessionId: "ses_1" })
  }
  assert.equal(scheduled.length, 0)
})

test("an alert held while the app was open still arrives if the user minimizes", async () => {
  // "Send a prompt and minimize" is the normal flow: a short run finishes
  // while the app is still technically active, and simply dropping the alert
  // is why completion notifications were never seen.
  const { exports, scheduled, state } = harness({ appState: "active" })
  await exports.send({ category: "completed", title: "Task completed", body: "…", sessionId: "ses_1" })
  assert.equal(scheduled.length, 0)

  state.appState = "background"
  exports.flushHeld()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].title, "Task completed")
})

test("a stale hold is dropped instead of buzzing long afterwards", async () => {
  const { exports, scheduled, state, clock } = harness({ appState: "active" })
  await exports.send({ category: "completed", title: "Task completed", body: "…", sessionId: "ses_1" })
  // The app only reached the background a minute later (e.g. a call came in):
  // the answer was already read, so the alert is noise by then.
  clock.now += 60_000
  state.appState = "background"
  exports.flushHeld()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(scheduled.length, 0)
})

test("flushHeld posts each held alert once", async () => {
  const { exports, scheduled, state } = harness({ appState: "active" })
  await exports.send({ category: "completed", title: "Task completed", body: "…", sessionId: "ses_1" })
  state.appState = "background"
  exports.flushHeld()
  exports.flushHeld()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(scheduled.length, 1)
})

test("an alert generated by the replay on resume never surfaces later", async () => {
  // Opening the app replays what happened while it was away; those alerts are
  // generated while the app is active and must be dropped when it comes back,
  // not posted on the next minimize ("notifications arrive right after opening").
  const { exports, scheduled, state } = harness({ appState: "active" })
  await exports.send({ category: "completed", title: "Task completed", body: "…", sessionId: "ses_1" })
  exports.dropHeld()
  state.appState = "background"
  exports.flushHeld()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(scheduled.length, 0)
})

test("a hold older than the short window is not posted", async () => {
  const { exports, scheduled, state, clock } = harness({ appState: "active" })
  await exports.send({ category: "completed", title: "Task completed", body: "…", sessionId: "ses_1" })
  clock.now += 4_000
  state.appState = "background"
  exports.flushHeld()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(scheduled.length, 0)
})

test("the background watch forces delivery even if AppState still says active", async () => {
  // The poll only runs in the background by construction; a wrong reading must
  // not swallow the alert (this is the failure the user kept hitting).
  const { exports, scheduled } = harness({ appState: "active" })
  await exports.send({ category: "completed", title: "Task completed", body: "…", sessionId: "ses_1" }, { force: true })
  assert.equal(scheduled.length, 1)
})

test("on Android the notification is posted natively, so its category picks the icon", async () => {
  // expo-notifications has one small icon for the whole app; the white square in
  // the status bar came from it being a full-colour bitmap.
  const { exports, nativeCalls, scheduled } = harness({ native: true })
  await exports.send({ category: "questions", title: "Input needed", body: "…", sessionId: "ses_1" })
  assert.equal(scheduled.length, 0, "expo must not post it on Android")
  assert.equal(nativeCalls.length, 1)
  assert.equal(nativeCalls[0].category, "questions")
  assert.equal(nativeCalls[0].channelId, "prompts")
  assert.equal(nativeCalls[0].sessionId, "ses_1")
})

test("a failed native post is reported instead of silently dropping the alert", async () => {
  const { exports, logs } = harness({ native: true, nativeFails: true })
  await exports.send({ category: "errors", title: "Session error", body: "…", sessionId: "ses_1" })
  assert.ok(logs.some((line) => line.includes("notify_failed")))
})

test("the test notification uses the same path, so it shows the real icon", async () => {
  const { exports, nativeCalls } = harness({ native: true })
  assert.equal((await exports.sendTest("Test", "Body")).ok, true)
  assert.equal(nativeCalls.length, 1)
  assert.equal(nativeCalls[0].category, "completed")
})

test("without a native module iOS keeps using expo-notifications", async () => {
  const { exports, scheduled } = harness()
  await exports.send({ category: "completed", title: "Task completed", body: "…", sessionId: "ses_1" })
  assert.equal(scheduled.length, 1)
})

test("the notification uses the app's own channel, not expo's fallback", async () => {
  // `trigger: null` drops channelId on the native side (BaseNotificationBuilder
  // falls back to expo_notifications_fallback_*), so the high-importance
  // channel the app configures was never used.
  const { exports, scheduled } = harness()
  await exports.send({ category: "questions", title: "Input needed", body: "…", sessionId: "ses_1" })
  // Compared field by field: the object comes from another VM context.
  assert.equal((scheduled[0].trigger as { channelId?: string }).channelId, "prompts")
})

test("a denied OS permission is logged instead of disappearing", async () => {
  const { exports, scheduled, logs } = harness({ status: "denied" })
  await exports.send({ category: "errors", title: "Session error", body: "…", sessionId: "ses_1" })
  assert.equal(scheduled.length, 0)
  assert.ok(logs.some((line) => line.includes("no-permission")))
})

test("a category the user turned off is dropped", async () => {
  const { exports, scheduled } = harness()
  exports.configure(() => ({
    permissions: false,
    questions: false,
    completed: false,
    errors: false,
    connection: false,
  }))
  await exports.send({ category: "completed", title: "Task completed", body: "…", sessionId: "ses_1" })
  assert.equal(scheduled.length, 0)
})

test("a native failure is logged and does not reject the event handler", async () => {
  const { exports, logs } = harness({ failSchedule: true })
  await exports.send({ category: "errors", title: "Session error", body: "…", sessionId: "ses_1" })
  assert.ok(logs.some((line) => line.startsWith("error") && line.includes("not supported")))
})

test("deduplication still stops a repeated prompt from buzzing twice", async () => {
  const { exports, scheduled } = harness()
  const payload = {
    category: "permissions" as const,
    title: "Agent needs approval",
    body: "…",
    sessionId: "ses_1",
    dedupeKey: "perm-1",
    dedupeCooldownMs: 60_000,
  }
  await exports.send(payload)
  await exports.send(payload)
  assert.equal(scheduled.length, 1)
})

test("the settings test button reports why a notification failed", async () => {
  const denied = harness({ status: "denied" })
  const deniedResult = await denied.exports.sendTest("Test", "Body")
  assert.equal(deniedResult.ok, false)
  assert.equal(deniedResult.reason, "denied")

  const broken = harness({ failSchedule: true })
  const brokenResult = await broken.exports.sendTest("Test", "Body")
  assert.equal(brokenResult.ok, false)
  assert.match(brokenResult.reason, /not supported/)

  const ok = harness()
  assert.equal((await ok.exports.sendTest("Test", "Body")).ok, true)
  assert.equal(ok.scheduled.length, 1)
})
