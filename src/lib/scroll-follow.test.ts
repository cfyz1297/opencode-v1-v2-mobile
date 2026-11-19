import { test } from "node:test"
import assert from "node:assert/strict"
import {
  shouldFollowBottom,
  FOLLOW_BOTTOM_MAX_OFFSET,
  MAINTAIN_VISIBLE_CONTENT_POSITION,
} from "./scroll-follow.ts"

test("the newest end is the bottom of an inverted transcript", () => {
  assert.equal(shouldFollowBottom(0), true)
  assert.equal(shouldFollowBottom(FOLLOW_BOTTOM_MAX_OFFSET), true)
})

test("scrolled up stops auto-following", () => {
  assert.equal(shouldFollowBottom(FOLLOW_BOTTOM_MAX_OFFSET + 1), false)
  assert.equal(shouldFollowBottom(1500), false)
})

// The anchor must be the newest row itself: with any higher index the list
// anchors the previous message, and a growing answer scrolls itself out of view.
test("the native maintainer anchors the newest row", () => {
  assert.equal(MAINTAIN_VISIBLE_CONTENT_POSITION.minIndexForVisible, 0)
})

// Without this threshold the list would stay pinned to the previous message and
// a new one would sit below the bottom edge.
test("a jump to the newest end is limited to readers already there", () => {
  assert.equal(MAINTAIN_VISIBLE_CONTENT_POSITION.autoscrollToTopThreshold, FOLLOW_BOTTOM_MAX_OFFSET)
})
