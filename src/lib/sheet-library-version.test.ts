// The model and reasoning-effort pickers are @gorhom/bottom-sheet sheets that
// open from a ref (`expand()`). 5.2.11 rewrote how the sheet learns the window
// height (#2639), which is what the chip taps were missing after the SDK 58
// upgrade: the sheet was mounted, the tap landed, and nothing appeared.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))

const floor = [5, 2, 11]

test("the bottom-sheet build still carries the window-height fix", () => {
  const raw: string = pkg.dependencies["@gorhom/bottom-sheet"]
  const version = raw.replace(/^[^0-9]*/, "")
  const parts = version.split(".").map(Number)
  for (let i = 0; i < floor.length; i++) {
    if (parts[i] > floor[i]) return
    assert.equal(parts[i], floor[i], `@gorhom/bottom-sheet ${raw} is below the window-height fix`)
  }
})
