// "The notification has no icon, just a white square" — Android draws a
// notification's small icon as a monochrome mask, so a full-colour bitmap (the
// app icon, which expo-notifications uses by default) becomes a white block.
//
// The fix needs a monochrome drawable per category and a native posting path,
// because expo-notifications only knows one small icon for the whole app. These
// pin the wiring: a dropped resource or an unregistered package fails here, not
// on the phone.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (file: string) => readFileSync(path.join(root, file), "utf8")

const CATEGORIES = ["completed", "error", "question", "permission", "default"]

test("every notification category has its own monochrome drawable", () => {
  const drawables = readdirSync(path.join(root, "plugins/native/res/drawable"))
  for (const category of CATEGORIES) {
    assert.ok(drawables.includes(`notif_${category}.xml`), `missing notif_${category}.xml`)
  }
})

test("the icons are transparent masks, not bitmaps", () => {
  // A vector with a solid background would be painted as a filled square again.
  for (const category of CATEGORIES) {
    const icon = read(`plugins/native/res/drawable/notif_${category}.xml`)
    assert.match(icon, /<vector/)
    assert.doesNotMatch(icon, /<bitmap/)
    // White fill/stroke only: the system tints the mask itself.
    assert.match(icon, /#FFFFFFFF/)
    assert.doesNotMatch(icon, /#000000(?!00)/, `${category} must not paint a background`)
  }
})

test("the prebuild plugin ships the drawables and points expo at one of them", () => {
  const plugin = read("plugins/with-native-customizations.js")
  assert.match(plugin, /'native', 'res'/)
  assert.match(plugin, /expo\.modules\.notifications\.default_notification_icon/)
  assert.match(plugin, /@drawable\/notif_default/)
})

test("the plugin must be listed before expo-notifications", () => {
  // Manifest mods run in reverse registration order: the earlier plugin wins.
  const app = JSON.parse(read("app.json"))
  const plugins = app.expo.plugins.map((entry: unknown) => (Array.isArray(entry) ? entry[0] : entry))
  assert.ok(
    plugins.indexOf("./plugins/with-native-customizations.js") < plugins.indexOf("expo-notifications"),
    "the icon meta-data would be overwritten by the expo-notifications plugin",
  )
})

test("the native module is registered and maps every category to its icon", () => {
  const plugin = read("plugins/with-native-customizations.js")
  assert.match(plugin, /add\(NotifyPackage\(\)\)/)
  assert.match(plugin, /NotifyPackage/)

  const module = read("plugins/native/keepalive/NotifyModule.kt")
  for (const [category, drawable] of [
    ["questions", "notif_question"],
    ["errors", "notif_error"],
    ["completed", "notif_completed"],
    ["permissions", "notif_permission"],
  ]) {
    assert.match(module, new RegExp(`"${category}" -> R\\.drawable\\.${drawable}`))
  }
  // Anything else (connection drops) still gets a valid mask.
  assert.match(module, /else -> R\.drawable\.notif_default/)
})

test("a notification tap opens the session through the deep link the router handles", () => {
  const module = read("plugins/native/keepalive/NotifyModule.kt")
  assert.match(module, /opencode:\/\/session\//)
  // ACTION_MAIN (the launcher intent) drops the data URI — the link must be
  // ACTION_VIEW pointed at the same activity.
  assert.match(module, /Intent\.ACTION_VIEW/)
  // Untrusted input reaching a URL: the id is validated in JS (isSafeSessionId)
  // and the intent is scoped to this package's launch activity.
  assert.match(module, /getLaunchIntentForPackage/)
  assert.match(module, /FLAG_IMMUTABLE/)
})

test("the keep-alive card is removed after the service is promoted", () => {
  // Android promotes an FGS notification's channel to at least IMPORTANCE_LOW,
  // so a NONE channel is silently upgraded and the "Session running" card comes
  // back — exactly what happened in 0.3.15. The channel must be deleted *after*
  // startForeground: deleting it cancels the notification, the service stays in
  // the foreground state.
  const service = read("plugins/native/keepalive/KeepAliveService.kt")
  const start = service.indexOf("startForeground(")
  const deletions = [...service.matchAll(/deleteNotificationChannel\(/g)].map((match) => match.index ?? -1)
  assert.ok(deletions.length >= 2, "one deletion for the stale channel, one to hide the card")
  assert.ok(
    deletions.some((index) => index > start),
    "the card is only removed when the channel is deleted after startForeground",
  )
  // An old channel with a different importance blocks recreation, so it is
  // replaced before startForeground too.
  assert.ok(deletions.some((index) => index < start))
  assert.match(service, /NotificationManager\.IMPORTANCE_NONE/)
  // Creating the channel as LOW is the bug being fixed, not a comment about it.
  assert.doesNotMatch(service, /NotificationManager\.IMPORTANCE_LOW\)/)
  // Pre-Oreo has no channels; the notification is cancelled directly.
  assert.match(service, /manager\.cancel\(NOTIFICATION_ID\)/)
})
