// Streaming an answer must not scroll the transcript out from under a reader
// who stopped at some line. The inverted list shifts every older row down when
// the newest row grows; the screen corrects the offset by that same amount
// unless the reader is at the bottom or still dragging.
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
  assert.match(block, /onContentSizeChange=\{[\s\S]{0,900}anchorShift\(/, "the reading position must be kept while an answer streams")
  assert.match(block, /followBottomRef\.current\)[\s\S]{0,200}scrollToOffset\(\{ offset: 0/, "at the bottom the list still follows the stream")
})

test("the newest row's height is measured as the anchor", () => {
  assert.match(sessionSource, /row\.id === newestRowId[\s\S]{0,160}newestCellRef\.current/, "cell layouts must record the newest row")
})

test("a drag takes over immediately and releases at the bottom", () => {
  const block = listBlock()
  assert.match(block, /onScrollBeginDrag=\{[\s\S]{0,300}followBottomRef\.current = false/, "a finger on the list stops auto-follow at once")
  assert.match(block, /onScrollEndDrag=\{[\s\S]{0,300}handleScroll\(event\)/, "the end of the gesture settles the position")
  assert.match(block, /onMomentumScrollEnd=\{[\s\S]{0,300}handleScroll\(event\)/, "so does the end of the fling")
})
