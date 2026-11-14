// Reported from the device: with the keyboard open the reasoning-effort picker
// rendered behind the IME and its last row ("High") could not be tapped. The
// sheet is a native view under node:test, so the fix is pinned in the sources.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (p: string) => readFileSync(path.join(root, p), "utf8")

test("the variant sheet moves with the keyboard like its siblings", () => {
  const sheet = read("src/components/chat/VariantPicker.tsx")
  assert.match(sheet, /keyboardBehavior="interactive"/)
  assert.match(sheet, /android_keyboardInputMode="adjustResize"/)
})

test("opening the variant picker dismisses the keyboard first", () => {
  const screen = read("app/session/[id].tsx")
  const chip = screen.slice(screen.indexOf('testID="variant-chip"') - 400, screen.indexOf('testID="variant-chip"'))
  assert.match(chip, /Keyboard\.dismiss\(\)/, "the picker has no input, so the IME is only obstruction")
})

// Reported again for the model picker: opened from the composer with the IME
// still up, the 50% sheet sits under the keyboard and the rest of the list is
// unreachable. Same treatment as the effort picker.
test("opening the model picker dismisses the keyboard first, both from the chip and /model", () => {
  const screen = read("app/session/[id].tsx")
  const opener = screen.slice(screen.indexOf("const openModelPicker"), screen.indexOf("const openModelPicker") + 700)
  assert.match(opener, /Keyboard\.dismiss\(\)/)
  // The chip and the builtin command share this one opener, so both paths are
  // covered by the assertion above.
  assert.match(screen, /onPress=\{openModelPicker\}/)
  assert.match(screen, /case "model":[\s\S]{0,120}openModelPicker\(\)/)
})

test("the model sheet itself still follows the keyboard for its search field", () => {
  const sheet = read("src/components/chat/ModelPicker.tsx")
  assert.match(sheet, /keyboardBehavior="interactive"/)
  assert.match(sheet, /keyboardBlurBehavior="restore"/)
  assert.match(sheet, /android_keyboardInputMode="adjustResize"/)
})
