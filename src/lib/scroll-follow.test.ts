// Auto-follow decision for the inverted chat FlatList: offset 0 is the latest
// message (visual bottom), larger offsets mean the user scrolled up.
import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldFollowBottom, anchorShift, FOLLOW_BOTTOM_MAX_OFFSET } from "./scroll-follow.ts"

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
})

