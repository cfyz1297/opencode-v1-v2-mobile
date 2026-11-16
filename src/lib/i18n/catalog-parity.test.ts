// Guards against locale drift: every shipped catalog (en, ru, zh-Hans) must
// expose exactly the same set of translation keys, or i18next silently falls
// back to the key path (en) / nothing sensible (missing copy) at runtime. Run
// with plain `node --test` — no i18next/expo-localization imports needed,
// same as locale-resolve.test.ts.
import { test } from "node:test"
import assert from "node:assert/strict"
import en from "./en.json" with { type: "json" }
import ru from "./ru.json" with { type: "json" }
import zhHans from "./zh-Hans.json" with { type: "json" }

const CATALOGS = [["en", en], ["ru", ru], ["zh-Hans", zhHans]] as const

// Flattens a nested translation object into dotted leaf-key paths, e.g.
// { settings: { language: { label: "..." } } } -> ["settings.language.label"]
function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix]
  const keys: string[] = []
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === "object" && value !== null) {
      keys.push(...flattenKeys(value, path))
    } else {
      keys.push(path)
    }
  }
  return keys
}

test("every catalog exposes the same set of translation keys (en is the source of truth)", () => {
  const enKeys = new Set(flattenKeys(en))

  for (const [name, catalog] of CATALOGS) {
    if (name === "en") continue
    const keys = new Set(flattenKeys(catalog))

    const missing = [...enKeys].filter((k) => !keys.has(k)).sort()
    const extra = [...keys].filter((k) => !enKeys.has(k)).sort()

    assert.deepEqual(missing, [], `keys present in en.json but missing from ${name}.json: ${missing.join(", ")}`)
    assert.deepEqual(extra, [], `keys present in ${name}.json but missing from en.json: ${extra.join(", ")}`)
  }
})

test("no translation value is an empty string", () => {
  for (const [name, catalog] of CATALOGS) {
    const keys = flattenKeys(catalog)
    for (const key of keys) {
      const value = key.split(".").reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], catalog)
      assert.notEqual(value, "", `${name}.json: "${key}" is an empty string`)
    }
  }
})

// A nested object where a string belongs still passes the key-set check above
// (its children flatten to keys) and then renders as "[object Object]".
test("every leaf is a string, not a nested locale map", () => {
  for (const [name, catalog] of CATALOGS) {
    for (const key of flattenKeys(catalog)) {
      const value = key.split(".").reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], catalog)
      assert.equal(typeof value, "string", `${name}.json: "${key}" must be a string, got ${typeof value}`)
    }
  }
})
