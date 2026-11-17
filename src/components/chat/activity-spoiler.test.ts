// Guard for the transcript's activity spoiler.
//
// The screen cannot be rendered under node:test, so the contract is pinned at
// the source level: answers stay visible, reasoning and tool calls of a
// segment fold into exactly one spoiler, the collapsed line names the tools it
// used and how long they took (the desktop client's summary), the existing tool
// cards are reused inside, and every style has a dark counterpart.
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

test("the collapsed line names the tools and their total time", () => {
  // Desktop parity: "5 · Shell, Read · 12.3s" instead of a bare step count.
  assert.match(spoiler, /summarizeToolActivity\(tools/, "the header must summarize the tools")
  assert.match(spoiler, /summary\.kinds\.map/, "distinct tool names belong on the line")
  assert.match(spoiler, /chat\.toolKind\./, "names come from the catalog, not the raw tool id")
  assert.match(spoiler, /formatDurationMs\(summary\.totalMs\)/, "the total time comes from the run")
  assert.match(spoiler, /accessibilityLabel=\{speech\}/, "TalkBack gets the spelled-out form")
})

test("a running block keeps its total moving", () => {
  assert.match(spoiler, /useTickingNow/, "a running run needs a clock")
  assert.match(spoiler, /setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\)/, "the clock ticks once a second")
  assert.match(spoiler, /return \(\) => clearInterval\(id\)/, "and stops when the run ends")
})

test("the spoiler reports progress and failure while collapsed", () => {
  assert.match(spoiler, /summary\.running/, "a live run needs a spinner on the collapsed row")
  assert.match(spoiler, /summary\.failed/, "a failed run needs an error mark on the collapsed row")
  assert.match(spoiler, /accessibilityState=\{\{ expanded \}\}/, "TalkBack must know the row expands")
})

test("every spoiler style has a dark counterpart", () => {
  for (const name of ["block", "count", "label", "duration"]) {
    const body = stylesheet.match(new RegExp(`\\n  ${name}: \\{([^}]+)\\}`))?.[1] ?? ""
    const dark = stylesheet.match(new RegExp(`\\n  ${name}Dark: \\{([^}]+)\\}`))?.[1] ?? ""
    assert.ok(body, `${name} must keep a light style`)
    assert.ok(dark, `${name} needs a dark counterpart`)
    assert.ok(spoiler.includes(`isDark && s.${name}Dark`), `${name}Dark must reach the render`)
  }
})
