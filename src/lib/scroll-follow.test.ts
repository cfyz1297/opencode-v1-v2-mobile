// Auto-follow decision for the inverted chat FlatList: offset 0 is the latest
// message (visual bottom), larger offsets mean the user scrolled up.
import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldFollowBottom, anchorShift, contentGrowthAction, FOLLOW_BOTTOM_MAX_OFFSET } from "./scroll-follow.ts"

test("at the bottom (offset 0) new content is followed", () => {
  assert.equal(shouldFollowBottom(0), true)
})

test("small overscroll bounce is still treated as bottom", () => {
  assert.equal(shouldFollowBottom(-12), true)
  assert.equal(shouldFollowBottom(FOLLOW_BOTTOM_MAX_OFFSET), true)
})

test("scrolled up stops auto-following", () => {
  assert.equal(shouldFollowBottom(FOLLOW_BOTTOM_MAX_OFFSET + 1), false)
  assert.equal(shouldFollowBottom(1500), false)
})

// Anchor correction: the newest row grows while the user is reading above it.
test("a growing newest row moves the offset by the same amount", () => {
  assert.equal(anchorShift({ id: "a", height: 200 }, { id: "a", height: 260 }), 60)
})

test("an unchanged newest row leaves the reading position alone", () => {
  assert.equal(anchorShift({ id: "a", height: 200 }, { id: "a", height: 200 }), 0)
})

test("a collapsing newest row does not scroll backwards", () => {
  assert.equal(anchorShift({ id: "a", height: 260 }, { id: "a", height: 200 }), 0)
})

test("a new newest row shifts the transcript by its whole height", () => {
  assert.equal(anchorShift({ id: "a", height: 200 }, { id: "b", height: 90 }), 90)
})

test("unmeasured cells and first layouts need no correction", () => {
  assert.equal(anchorShift({ id: "a", height: 200 }, undefined), 0)
  assert.equal(anchorShift(undefined, { id: "b", height: 90 }), 0)
})

// The decision the transcript runs on every content-size event. Both fields
// below broke a shipped build once, so each case is pinned.
const idle = { atBottom: false, held: false, dragging: false, jumping: false, grown: 0 }

test("at the newest end the list pins to the stream", () => {
  assert.deepEqual(contentGrowthAction({ ...idle, atBottom: true }), { kind: "pin" })
})

test("a navigator tap at the newest end keeps its position", () => {
  assert.deepEqual(contentGrowthAction({ ...idle, atBottom: true, held: true }), { kind: "none" })
})

test("a drag owns the position, at the newest end or not", () => {
  assert.deepEqual(contentGrowthAction({ ...idle, atBottom: true, dragging: true }), { kind: "none" })
  assert.deepEqual(contentGrowthAction({ ...idle, dragging: true, grown: 40 }), { kind: "none" })
})

test("reading up the transcript shifts by the growth so the text stays put", () => {
  assert.deepEqual(contentGrowthAction({ ...idle, grown: 40 }), { kind: "shift", by: 40 })
})

test("no growth and a jump in flight both leave the offset alone", () => {
  assert.deepEqual(contentGrowthAction({ ...idle, grown: 0 }), { kind: "none" })
  assert.deepEqual(contentGrowthAction({ ...idle, grown: 40, jumping: true }), { kind: "none" })
})

