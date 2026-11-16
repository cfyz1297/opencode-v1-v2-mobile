// Guard for the transcript's activity spoiler.
//
// The screen cannot be rendered under node:test, so the contract is pinned at
// the source level: answers stay visible, reasoning and tool calls of a
// segment fold into exactly one spoiler, the existing tool cards are reused
// inside it, and every style has a dark counterpart.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const bubble = readFileSync(new URL("./MessageBubble.tsx", import.meta.url), "utf8")
const spoiler = readFileSync(new URL("./ActivitySpoiler.tsx", import.meta.url), "utf8")
const stylesheet = spoiler.slice(spoiler.indexOf("const s = StyleSheet.create("))

test("the bubble folds activity into one spoiler and keeps text on screen", () => {
  assert.match(bubble, /<ActivitySpoiler/, "activity must render through the spoiler")
  assert.match(bubble, /item\.kind === "text"/, "text parts must still render directly")
  // No second path that renders reasoning or tool cards outside the spoiler:
  // that is what made a long run fill the screen.
  assert.doesNotMatch(bubble, /<ReasoningBlock/, "reasoning must not render outside the spoiler")
  assert.doesNotMatch(bubble, /<ToolRun/, "tool runs must not render outside the spoiler")
})

test("the spoiler starts collapsed and reuses the existing tool design", () => {
  assert.match(spoiler, /useState\(false\)/, "spoiler must start collapsed")
  assert.match(spoiler, /<ReasoningBlock/, "reasoning keeps its existing row inside")
  assert.match(spoiler, /<ToolRun/, "tool calls keep their existing rows inside")
  assert.match(spoiler, /expanded &&/, "body must only render when opened")
})

test("the spoiler reports progress and failure while collapsed", () => {
  assert.match(spoiler, /status === "running"/, "a live run needs a spinner on the collapsed row")
  assert.match(spoiler, /status === "error"/, "a failed run needs an error mark on the collapsed row")
  assert.match(spoiler, /accessibilityState=\{\{ expanded \}\}/, "TalkBack must know the row expands")
})

test("every spoiler style has a dark counterpart", () => {
  for (const name of ["block", "label"]) {
    const body = stylesheet.match(new RegExp(`\\n  ${name}: \\{([^}]+)\\}`))?.[1] ?? ""
    const dark = stylesheet.match(new RegExp(`\\n  ${name}Dark: \\{([^}]+)\\}`))?.[1] ?? ""
    assert.ok(body, `${name} must keep a light style`)
    assert.ok(dark, `${name} needs a dark counterpart`)
  }
  assert.match(spoiler, /isDark && s\.blockDark/, "dark block style must reach the render")
  assert.match(spoiler, /isDark && s\.labelDark/, "dark label style must reach the render")
})
