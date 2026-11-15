// "Notifications never arrive" had two causes on Android:
//
//  1. send() dropped every notification while the app was in the foreground —
//     but with the chat on screen the user was not looking at the shade, and
//     the notification was the only sign that a run finished.
//  2. Even with the app backgrounded, Android freezes a cached RN process
//     within seconds. The SSE socket that generates the notifications dies
//     with it, so alerts for a locked phone never fired at all.
//
// The foreground rule is now gone: every enabled category is delivered, which
// notifications-send.test.ts runs against a fake native module. The keep-alive
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
  assert.match(plugin, /FOREGROUND_SERVICE_SPECIAL_USE/)
  assert.match(plugin, /foregroundServiceType': 'dataSync\|specialUse'/)
  assert.match(plugin, /PROPERTY_SPECIAL_USE_FGS_SUBTYPE/)
  assert.match(plugin, /KeepAliveService/)
  assert.match(plugin, /add\(KeepAlivePackage\(\)\)/)
})

test("the service goes foreground with a type and is not exported", () => {
  const service = read("plugins/native/keepalive/KeepAliveService.kt")
  assert.match(service, /startForeground\(/)
  // Android 15 caps dataSync at 6h per 24 and kills the app when a long
  // background run exhausts the budget, so the type switches to specialUse.
  assert.match(service, /FOREGROUND_SERVICE_TYPE_SPECIAL_USE/)
  assert.match(service, /UPSIDE_DOWN_CAKE[\s\S]{0,200}FOREGROUND_SERVICE_TYPE_SPECIAL_USE/)
  assert.match(service, /FOREGROUND_SERVICE_TYPE_DATA_SYNC/)
  // Without the callback the system terminates the app on a dataSync timeout.
  assert.match(service, /override fun onTimeout\(startId: Int\)[\s\S]{0,80}stopSelf/)
  const plugin = read("plugins/with-native-customizations.js")
  assert.match(plugin, /'android:exported': 'false'/)
})

test("a killed process does not leave a headless React instance for the next launch", () => {
  // HeadlessJsTaskService returns START_REDELIVER_INTENT: Android would restart
  // the service after a process death and boot a headless React instance, and
  // the next launch then shows the splash and closes.
  const service = read("plugins/native/keepalive/KeepAliveService.kt")
  assert.match(service, /super\.onStartCommand\(intent, flags, startId\)[\s\S]{0,600}START_NOT_STICKY/)
})

test("the service runs a headless JS task, which is what re-enables background timers", () => {
  // React Native removes its timer frame callback while the host is paused
  // unless a headless task is active (JavaTimerManager.kt), so a plain
  // foreground service leaves setInterval dead in the background.
  const service = read("plugins/native/keepalive/KeepAliveService.kt")
  assert.match(service, /HeadlessJsTaskService/)
  assert.match(service, /HeadlessJsTaskConfig\(\s*TASK_KEY/)
  // 0 = no timeout: terminating the React instance mid-run is worse than
  // keeping the task alive.
  assert.match(service, /0,/)
  const bridge = read("src/lib/keep-alive.ts")
  assert.match(bridge, /AppRegistry\.registerHeadlessTask\(TASK_KEY/)
  // The task key must match on both sides.
  assert.match(service, /TASK_KEY = "KeepAliveBackground"/)
  assert.match(bridge, /TASK_KEY = "KeepAliveBackground"/)
})

test("the store keeps the service alive only while a run is active", () => {
  const events = read("src/stores/events.ts")
  assert.match(events, /setKeepAlive\(activeRunSessionIDs\(\)\.length > 0\)/)
  // Stopping when the run ends must happen on both paths: a real idle event
  // and the local "server says it is done" recovery.
  assert.match(events, /function finishRunLocally[\s\S]*?syncKeepAlive\(\)/)
  // A send that is backgrounded before the busy event arrives still needs the
  // service: that event travels over the socket the service exists to keep.
  assert.match(read("src/stores/sessions.ts"), /sending: \{ \.\.\.state\.sending, \[session\.id\]: true \}[\s\S]{0,400}setKeepAlive\(true\)/)
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

test("settings makes a blocked OS permission visible", () => {
  // Android refuses to show the permission dialog after a denial, and a
  // suppressed notification is silent by design — without this row the user has
  // no way to tell "denied" from "broken".
  const settings = read("app/(tabs)/settings.tsx")
  assert.match(settings, /Linking\.openSettings\(\)/)
  assert.match(settings, /settings\.notifications\.status\.blocked/)
})

test("held alerts are flushed when the app leaves the foreground and dropped when it returns", () => {
  const layout = read("app/_layout.tsx")
  assert.match(layout, /next === "background"[\s\S]{0,400}notifications\.flushHeld\(\)/)
  // Otherwise an alert generated by the event replay on resume surfaces later,
  // right after the user has already looked at the transcript.
  assert.match(layout, /next === "active"[\s\S]{0,400}notifications\.dropHeld\(\)/)
})

test("the background watch marks its notifications as background-generated", () => {
  const events = read("src/stores/events.ts")
  const poll = events.slice(events.indexOf("async function pollWhileBackgrounded"))
  assert.match(poll, /refreshPending\(clientFor\(sessionID\) \?\? client, sessionID, \{ background: true \}\)/)
  assert.match(poll, /activeSessionIDs\(client\)/)
  // Server truth, not local status: the local busy flag and the optimistic
  // `sending` flag both come from events a backgrounded app never receives.
  assert.match(poll, /lastActiveSeen/)
})
