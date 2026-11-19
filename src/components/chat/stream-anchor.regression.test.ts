// The transcript must keep a reader's place while an answer streams in, and it
// must keep following the answer at the newest end. The decision itself is
// unit-tested in src/lib/scroll-follow.test.ts; this file checks that the screen
// actually measures the movement and wires it to the list.
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

test("the shift is the movement the rows themselves reported", () => {
  assert.match(sessionSource, /pendingShiftRef\.current \+= frameShift\(known, y\)/, "cells must report their displacement")
  const block = listBlock()
  assert.match(block, /const grown = pendingShiftRef\.current/, "the content-size event must consume the measured movement")
  assert.match(block, /pendingShiftRef\.current = 0/, "the movement must be consumed once")
})

// The regression this guards: following was a stored flag, a missed gesture
// event left it off, and the correction then pushed the streaming answer below
// the viewport — the answer looked like it never streamed at all.
test("following is decided from the live offset, not from a stored flag", () => {
  assert.doesNotMatch(sessionSource, /followBottomRef/, "a latched follow flag is what broke the stream")
  assert.match(listBlock(), /atBottom: shouldFollowBottom\(listOffsetRef\.current\)/, "the live offset decides")
})

// A height delta taken from the newest row was the previous mechanism; it went
// blind whenever the streaming row's identity changed.
test("the anchor no longer depends on the newest row's identity", () => {
  assert.doesNotMatch(sessionSource, /newestRowIdRef|newestCellRef|anchoredNewestRef/, "no id-keyed height bookkeeping")
})

test("a drag takes over immediately and releases at the bottom", () => {
  const block = listBlock()
  assert.match(block, /onScrollBeginDrag=\{[\s\S]{0,300}scrollActiveRef\.current = true/, "a finger on the list owns the position at once")
  assert.match(block, /onScrollEndDrag=\{[\s\S]{0,300}handleScroll\(event\)/, "the end of the gesture settles the position")
  assert.match(block, /onMomentumScrollEnd=\{[\s\S]{0,300}handleScroll\(event\)/, "so does the end of the fling")
})
