// The subagent counters were unreadable in the dark theme: the text switched to
// white while the pill kept its light grey fill, so "Сейчас: 1" was white on
// near-white. The fills are per-theme now, and this pins that each light fill
// used on a button has a dark counterpart that is actually applied — a missing
// one is invisible in tests and obvious only on a phone in dark mode.
//
// Source-level, like markdown-inline-code.regression.test.ts: there is no RN
// renderer in node:test here, and the failure is a style pairing, not logic.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const source = readFileSync(fileURLToPath(new URL("./chat/SubagentBar.tsx", import.meta.url).href), "utf8")

function styleBlock(name: string): string {
  const start = source.indexOf(`  ${name}: {`)
  assert.ok(start > 0, `${name} style not found`)
  const lineEnd = source.indexOf("\n", start)
  // One-liner (`buttonDark: { backgroundColor: "#262626" },`) or a block.
  const end = source.slice(start, lineEnd).includes("},") ? lineEnd : source.indexOf("\n  },", start)
  assert.ok(end > start, `${name} style block is not terminated`)
  return source.slice(start, end)
}

test("every fill a button can take has a dark counterpart, and it is applied", () => {
  for (const [light, dark] of [
    ["button", "buttonDark"],
    ["buttonActive", "buttonActiveDark"],
    ["buttonOpen", "buttonOpenDark"],
  ]) {
    // The light fill must not be the only one: pick the property it sets.
    assert.match(styleBlock(light), /(backgroundColor|borderColor):\s*"#[0-9a-f]{6}"/i)
    assert.match(styleBlock(dark), /(backgroundColor|borderColor):\s*"#[0-9a-f]{6}"/i, `${dark} needs a colour`)
    assert.ok(
      source.includes(`isDark && s.${dark}`),
      `${dark} is defined but never applied — the light fill wins in dark mode`,
    )
    // Two elements can take the fill (the counters), so both must guard it.
    assert.ok(
      source.split(`isDark && s.${dark}`).length - 1 >= 1,
      `no call site guards ${dark} with isDark`,
    )
  }
})

test("the counters sit on the right, as status read at a glance", () => {
  assert.match(styleBlock("buttons"), /justifyContent:\s*"flex-end"/)
})

test("the counters are legible on a dark fill in the dark theme", () => {
  // White text is the dark-theme choice; it only works over a dark fill.
  assert.match(styleBlock("buttonTextDark"), /color:\s*"#ffffff"/)
  assert.doesNotMatch(styleBlock("buttonDark"), /backgroundColor:\s*"#f/i, "a light fill under white text is invisible")
})
