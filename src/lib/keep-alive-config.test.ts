// "Notifications never arrive" had two causes on Android:
//
//  1. send() dropped every notification while the app was in the foreground —
//     but with the chat on screen the user was not looking at the shade, and
//     the notification was the only sign that a run finished.
//  2. Even with the app backgrounded, Android freezes a cached RN process
//     within seconds. The SSE socket that generates the notifications dies
//     with it, so alerts for a locked phone never fired at all.
//
// The foreground rule is unit-tested in notify-policy.test.ts. The keep-alive
// service is native code that Expo prebuild regenerates, so these pin the
// wiring: a dropped plugin step must fail a test, not a phone.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (file: string) => readFileSync(path.join(root, file), "utf8")

test("the prebuild plugin declares the foreground service and its permissions", () => {
  const plugin = read("plugins/with-native-customizations.js")
  assert.match(plugin, /FOREGROUND_SERVICE/)
  assert.match(plugin, /FOREGROUND_SERVICE_DATA_SYNC/)
  assert.match(plugin, /foregroundServiceType: 'dataSync'|foregroundServiceType': 'dataSync'/)
  assert.match(plugin, /KeepAliveService/)
  assert.match(plugin, /add\(KeepAlivePackage\(\)\)/)
})

test("the service goes foreground with a type and is not exported", () => {
  const service = read("plugins/native/keepalive/KeepAliveService.kt")
  assert.match(service, /startForeground\(/)
  assert.match(service, /FOREGROUND_SERVICE_TYPE_DATA_SYNC/)
  const plugin = read("plugins/with-native-customizations.js")
  assert.match(plugin, /'android:exported': 'false'/)
})

test("the store keeps the service alive only while a run is active", () => {
  const events = read("src/stores/events.ts")
  assert.match(events, /setKeepAlive\(\s*activeRunSessionIDs\(\)\.length > 0/)
  // Stopping when the run ends must happen on both paths: a real idle event
  // and the local "server says it is done" recovery.
  assert.match(events, /function finishRunLocally[\s\S]*?syncKeepAlive\(\)/)
})

test("a missing native bridge cannot break the event stream", () => {
  const bridge = read("src/lib/keep-alive.ts")
  assert.match(bridge, /NativeModules\.KeepAlive/)
  assert.match(bridge, /catch \{/)
})

test("the notification permission is not blocked at build time", () => {
  // A blocked permission reaches the APK as tools:node="remove" and Android 13+
  // can never grant it — the same way RECORD_AUDIO disappeared in 0.3.7.
  const app = JSON.parse(read("app.json"))
  const blocked: string[] = app.expo.android.blockedPermissions ?? []
  assert.ok(!blocked.includes("android.permission.POST_NOTIFICATIONS"))
})

test("the chat screen marks itself as viewed and clears it on blur", () => {
  // Without the clear, every notification for a session ever opened would stay
  // suppressed while the app is in the foreground.
  const screen = read("app/session/[id].tsx")
  assert.match(screen, /setViewedSession\(id\)/)
  assert.match(screen, /setViewedSession\(null\)/)
})
