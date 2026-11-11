// Voice input has never worked: expo-image-picker was configured with
// `microphonePermission: false`, and that plugin turns the value into a
// blockedPermissions entry, which expo writes as
// `<uses-permission android:name="android.permission.RECORD_AUDIO"
// tools:node="remove"/>`. The permission then never reaches the merged
// manifest, so requestPermissionsAsync can only ever answer "denied".
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const expo = JSON.parse(readFileSync(path.join(root, "app.json"), "utf8")).expo

function pluginOptions(name: string): Record<string, unknown> | undefined {
  for (const entry of expo.plugins ?? []) {
    if (Array.isArray(entry) && entry[0] === name) return entry[1]
  }
  return undefined
}

test("nothing strips the microphone permission from the manifest", () => {
  // `false` means "block RECORD_AUDIO", not "don't ask for it".
  const picker = pluginOptions("expo-image-picker")
  assert.notEqual(
    picker?.microphonePermission,
    false,
    "expo-image-picker microphonePermission:false removes RECORD_AUDIO and kills voice input",
  )

  const blocked: string[] = expo.android?.blockedPermissions ?? []
  assert.ok(!blocked.includes("android.permission.RECORD_AUDIO"), "RECORD_AUDIO must not be blocked")
})

test("speech recognition is still configured and declared", () => {
  assert.ok(pluginOptions("expo-speech-recognition"), "expo-speech-recognition plugin is missing")
})
