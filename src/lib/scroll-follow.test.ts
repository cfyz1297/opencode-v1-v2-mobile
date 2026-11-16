// Auto-follow decision for the inverted chat FlatList: offset 0 is the latest
// message (visual bottom), larger offsets mean the user scrolled up.
import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldFollowBottom, shouldShowNavStrip, FOLLOW_BOTTOM_MAX_OFFSET, NAV_STRIP_MIN_OFFSET } from "./scroll-follow.ts"

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

// The navigation strip is a separate decision with a looser threshold (it
// costs 56pt of layout height, so it must not flicker on a small nudge).
test("navigation strip appears only past its own threshold", () => {
  assert.equal(shouldShowNavStrip(0), false)
  assert.equal(shouldShowNavStrip(NAV_STRIP_MIN_OFFSET), false)
  assert.equal(shouldShowNavStrip(NAV_STRIP_MIN_OFFSET + 1), true)
})

test("a nudge past the auto-follow edge does not pop the strip", () => {
  // The range where reading has already stopped but the strip stays hidden.
  assert.equal(shouldFollowBottom(FOLLOW_BOTTOM_MAX_OFFSET + 1), false)
  assert.equal(shouldShowNavStrip(FOLLOW_BOTTOM_MAX_OFFSET + 1), false)
})
