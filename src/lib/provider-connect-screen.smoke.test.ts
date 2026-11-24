import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")
const connectSrc = readFileSync(join(root, "app/providers/connect.tsx"), "utf8")

test("connect screen does not import device secret stores", () => {
  assert.equal(/SecureStore|AsyncStorage|expo-secure-store|@react-native-async-storage/i.test(connectSrc), false)
  assert.match(connectSrc, /connectApiKey/)
  assert.match(connectSrc, /setApiKey\(""\)/)
})

test("connect screen validates the deep-link id before it selects the provider", () => {
  // Ties the screen to the validator: a case-normalising or lenient parser here
  // would send the key to an id the screen never displayed.
  assert.match(connectSrc, /validateConnectProviderId\(typeof params\.id/)
})

test("connect screen never labels the write with a deep-link name", () => {
  // The name must come from the id being written; ?name= could say OpenAI while
  // /auth/wafer.ai receives the key.
  assert.equal(/params\.name/.test(connectSrc), false)
})
