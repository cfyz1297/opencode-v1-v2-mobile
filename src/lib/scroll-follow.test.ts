// Auto-follow decision for the inverted chat FlatList: offset 0 is the latest
// message (visual bottom), larger offsets mean the user scrolled up.
import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldFollowBottom, FOLLOW_BOTTOM_MAX_OFFSET } from "./scroll-follow.ts"

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

