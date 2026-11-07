// The "update available" strip is the only update channel for a sideloaded
// APK, so both of its reported failure modes are pinned in the source: opening
// the release page must be treated as "seen" (Linking.openURL resolves void —
// awaiting it says nothing about success), and a long-running app must re-check
// on foreground instead of only on mount.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const src = readFileSync(path.join(root, "src/components/UpdateBanner.tsx"), "utf8")

function block(start: string, end: string): string {
  const from = src.indexOf(start)
  assert.notEqual(from, -1, `missing ${start}`)
  const to = src.indexOf(end, from)
  assert.notEqual(to, -1, `missing ${end}`)
  return src.slice(from, to)
}

test("opening the release marks the version as seen and hides the banner", () => {
  const onOpen = block("const onOpen = useCallback(", "}, [update])")
  assert.match(onOpen, /await Linking\.openURL\(update\.url\)/)
  assert.doesNotMatch(onOpen, /const opened = await Linking\.openURL/, "openURL resolves void, never true")
  assert.match(onOpen, /dismissUpdate\(update\.version\)/)
  assert.match(onOpen, /setUpdate\(null\)/, "the strip must disappear immediately after a successful open")
})

test("the check runs again when the app returns to the foreground", () => {
  assert.match(src, /AppState\.addEventListener\("change"/)
  assert.match(src, /checkForUpdate\(\)/)
})
