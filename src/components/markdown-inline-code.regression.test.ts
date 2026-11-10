// Inline code used to be drawn as a highlight pill, and Android renders that
// pill out of place: for a code span that wraps, the bar is taller than its
// line — the bar of `pi-extension/` starts above the previous line and covers
// the letters there — and a code span with its own smaller font shifts the bar
// about half a line down. Both were reproduced on an Android 15 emulator, so
// the highlight itself is what corrupted chat, not just its font metrics.
//
// The shipped style therefore paints no background: inline code is marked by
// colour and monospace alone. Three details keep it that way:
//   1. react-native-marked's own codespan style carries a background. Omitting
//      the key leaves that one in place — it has to be transparent explicitly.
//   2. A nested Text that declares its own fontSize/lineHeight/lineHeight also
//      shifts its box, so the style must keep inheriting them.
//   3. The dark theme spreads the light one; it must not reintroduce the pill.
//
// The chat markdown is not rendered in node:test (no RN test renderer here), so
// the invariant is pinned in the source, the way
// wide-content-scroll.regression.test.ts does.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const source = readFileSync(fileURLToPath(new URL("./markdown/Markdown.tsx", import.meta.url).href), "utf8")

function styleBlocks(name: string): string[] {
  const blocks: string[] = []
  let from = 0
  for (;;) {
    const start = source.indexOf(`  ${name}: {`, from)
    if (start < 0) break
    const end = source.indexOf("\n  },", start)
    assert.ok(end > start, `${name} style block is not terminated`)
    blocks.push(
      source
        .slice(start, end)
        .split("\n")
        .filter((line) => !line.trim().startsWith("//")) // comments name the banned properties
        .join("\n"),
    )
    from = end
  }
  assert.ok(blocks.length > 0, `${name} style not found`)
  return blocks
}

test("inline code paints no background in either theme", () => {
  const [light, ...rest] = styleBlocks("codespan")
  assert.match(light, /backgroundColor:\s*"transparent"/,
    "omit the key and react-native-marked's own background applies; any real colour is drawn out of place on Android")
  assert.doesNotMatch(light, /backgroundColor:\s*"(?!transparent)/, "only transparent is safe")
  for (const block of rest) {
    assert.ok(
      /\.\.\.lightTheme\.codespan/.test(block) || /backgroundColor:\s*"transparent"/.test(block),
      "a theme that does not inherit the light codespan must disable the background itself",
    )
    assert.doesNotMatch(block, /backgroundColor:\s*"(?!transparent)/, "only transparent is safe")
  }
})

test("inline code declares no metrics of its own", () => {
  for (const block of styleBlocks("codespan")) {
    assert.doesNotMatch(block, /fontSize/, "inline code must inherit the paragraph's font size")
    assert.doesNotMatch(block, /lineHeight/, "inline code must inherit the paragraph's line height")
    assert.doesNotMatch(block, /padding/, "padding is ignored on a nested Text")
  }
})

test("inline code is still distinguishable", () => {
  const [light] = styleBlocks("codespan")
  assert.match(light, /fontFamily:\s*mono/)
  assert.match(light, /color:\s*"#[0-9a-f]{6}"/i, "the colour is what marks inline code now")
})
