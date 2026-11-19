// Keeping a reader's place while an answer streams is the native
// maintainVisibleContentPosition helper's job. Four hand-rolled versions of that
// correction shipped bugs — a latched follow flag hid the answer, a baseline
// written before its delta shifted by zero, summing cells multiplied the shift,
// and the content-size event arrives before the cells' own layouts so the delta
// was always a frame late. These checks keep the screen on the native path.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const sessionSource = readFileSync(new URL("../../../app/session/[id].tsx", import.meta.url), "utf8")

function listBlock(): string {
  const start = sessionSource.lastIndexOf("<FlatList")
  assert.ok(start >= 0, "the session screen must render a FlatList")
  return sessionSource.slice(start, sessionSource.indexOf("onEndReached", start))
}

test("the transcript hands scroll maintenance to the native helper", () => {
  assert.match(listBlock(), /maintainVisibleContentPosition=\{MAINTAIN_VISIBLE_CONTENT_POSITION\}/, "the list must use the shared config")
})

// The pin half was never the reported bug — the measured correction was. It
// stays because the native helper bounces a row when a new message arrives at
// the newest end.
test("content growth never recomputes a reading shift", () => {
  assert.doesNotMatch(sessionSource, /contentGrowthAction|pendingShiftRef|cellYRef|frameShift|measuredShift/, "no leftover correction machinery")
  assert.match(listBlock(), /onContentSizeChange=\{[\s\S]{0,200}atBottomRef\.current[\s\S]{0,120}scrollToOffset\(\{ offset: 0, animated: false \}\)/, "the pin must be instant and conditional")
})

// Android scrolls a focused child into view; a selectable <Text> takes focus on
// long-press and used to yank the transcript (facebook/react-native#33440).
test("long-press selection still cannot scroll the list", () => {
  assert.match(listBlock(), /scrollsChildToFocus=\{false\}/, "a focused selectable text must not be scrolled to")
})

// The native maintainer cancels a running fling whenever an answer grows, so a
// gliding jump to the newest end stops mid-flight while streaming.
test("jumps to the newest end are instant", () => {
  assert.doesNotMatch(sessionSource, /scrollToBottom\(true\)/, "an animated jump is cancelled by the maintainer")
  assert.doesNotMatch(sessionSource, /scrollToOffset\(\{ offset: 0, animated: true \}\)/, "same for the pending-question jump")
})
