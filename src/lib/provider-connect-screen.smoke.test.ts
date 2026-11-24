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
