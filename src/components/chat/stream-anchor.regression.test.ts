// Streaming an answer must not scroll the transcript out from under a reader
// who stopped at some line. The inverted list shifts every older row down when
// the newest row grows; the screen corrects the offset by that same amount —
// but only when the viewport really sits away from the newest end.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const sessionSource = readFileSync(new URL("../../../app/session/[id].tsx", import.meta.url), "utf8")

function listBlock(): string {
  const start = sessionSource.lastIndexOf("<FlatList")
  assert.ok(start >= 0, "the session screen must render a FlatList")
  return sessionSource.slice(start, sessionSource.indexOf("onEndReached", start))
}

test("content growth while reading away from the bottom is anchored to the newest row", () => {
  const block = listBlock()
  assert.match(block, /onContentSizeChange=\{[\s\S]{0,1200}anchorShift\(/, "the reading position must be kept while an answer streams")
  assert.match(block, /followBottomRef\.current\)[\s\S]{0,200}scrollToOffset\(\{ offset: 0/, "at the bottom the list still follows the stream")
})

test("the newest row's height is measured as the anchor", () => {
  assert.match(sessionSource, /row\.id === newestRowId[\s\S]{0,200}newestCellRef\.current/, "cell layouts must record the newest row")
})

// The regression this guards: auto-follow was latched off by a missed gesture
// event, and the correction then pushed the streaming answer below the
// viewport, so the answer looked like it never streamed at all.
test("auto-follow is derived from the position on every scroll event", () => {
  const handler = sessionSource.slice(sessionSource.indexOf("const handleScroll"), sessionSource.indexOf("const handleLoadMore"))
  assert.match(handler, /followBottomRef\.current = atBottom/, "the flag must come from the offset, not from a latch")
  assert.doesNotMatch(handler, /followBottomRef\.current = !nav\.held/, "a hold must not switch auto-follow off")
})

test("the correction never runs at the newest end or during a jump", () => {
  const block = listBlock()
  assert.match(block, /shouldFollowBottom\(listOffsetRef\.current\)\) return/, "at the bottom there is nothing to hold")
  assert.match(block, /nav\.expected !== undefined\) return/, "a jump in flight owns the position")
})

test("a drag takes over immediately and releases at the bottom", () => {
  const block = listBlock()
  assert.match(block, /onScrollBeginDrag=\{[\s\S]{0,300}followBottomRef\.current = false/, "a finger on the list stops auto-follow at once")
  assert.match(block, /onScrollEndDrag=\{[\s\S]{0,300}handleScroll\(event\)/, "the end of the gesture settles the position")
  assert.match(block, /onMomentumScrollEnd=\{[\s\S]{0,300}handleScroll\(event\)/, "so does the end of the fling")
})
