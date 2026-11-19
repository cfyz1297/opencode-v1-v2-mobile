// The transcript must keep a reader's place while an answer streams in, and it
// must keep following the answer at the newest end. The decision itself is
// unit-tested in src/lib/scroll-follow.test.ts; this file only checks that the
// screen wires it to the list and reads the delta before overwriting it.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const sessionSource = readFileSync(new URL("../../../app/session/[id].tsx", import.meta.url), "utf8")

function listBlock(): string {
  const start = sessionSource.lastIndexOf("<FlatList")
  assert.ok(start >= 0, "the session screen must render a FlatList")
  return sessionSource.slice(start, sessionSource.indexOf("onEndReached", start))
}

test("content growth runs through the shared decision", () => {
  assert.match(listBlock(), /contentGrowthAction\(\{/, "the list must not re-implement the decision")
})

// Measured-then-overwritten is the bug that shipped: the shift was always zero
// and the reading position drifted while an answer streamed.
test("the growth delta is read before the baseline is replaced", () => {
  const block = listBlock()
  const read = block.indexOf("const grown = anchorShift(")
  const write = block.indexOf("anchoredNewestRef.current = newestCellRef.current")
  assert.ok(read >= 0 && write >= 0, "both the delta and the baseline must be present")
  assert.ok(read < write, "writing the baseline first makes the delta zero")
})

test("the newest row's height is measured as the anchor", () => {
  assert.match(sessionSource, /row\.id === newestRowId[\s\S]{0,200}newestCellRef\.current/, "cell layouts must record the newest row")
})

// The regression this guards: auto-follow was a stored flag, a missed gesture
// event left it off, and the correction then pushed the streaming answer below
// the viewport — the answer looked like it never streamed at all.
test("following is decided from the live offset, not from a stored flag", () => {
  assert.doesNotMatch(sessionSource, /followBottomRef/, "a latched follow flag is what broke the stream")
  assert.match(listBlock(), /atBottom: shouldFollowBottom\(listOffsetRef\.current\)/, "the live offset decides")
})

test("a drag takes over immediately and releases at the bottom", () => {
  const block = listBlock()
  assert.match(block, /onScrollBeginDrag=\{[\s\S]{0,300}scrollActiveRef\.current = true/, "a finger on the list owns the position at once")
  assert.match(block, /onScrollEndDrag=\{[\s\S]{0,300}handleScroll\(event\)/, "the end of the gesture settles the position")
  assert.match(block, /onMomentumScrollEnd=\{[\s\S]{0,300}handleScroll\(event\)/, "so does the end of the fling")
})
