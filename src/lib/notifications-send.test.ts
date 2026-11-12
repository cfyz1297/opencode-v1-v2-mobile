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

function harness(options: { status?: string; failSchedule?: boolean; appState?: string } = {}) {
  const scheduled: Array<{ title: string; body: string; trigger: unknown }> = []
  const logs: string[] = []
  const state = { status: options.status ?? "granted", appState: options.appState ?? "background" }

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
    "react-native": { Platform: { OS: "android" }, AppState: { currentState: state.appState } },
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
    Date,
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
  return { exports, scheduled, logs, state }
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

test("nothing is posted while the app is open — the transcript already shows it", async () => {
  // Reported from the device: banners over an open chat are noise.
  const { exports, scheduled } = harness({ appState: "active" })
  for (const category of ["completed", "questions", "permissions", "errors"] as const) {
    await exports.send({ category, title: "t", body: "b", sessionId: "ses_1" })
  }
  assert.equal(scheduled.length, 0)
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
  assert.ok(logs.some((line) => line.includes("permission not granted")))
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
