import { test } from "node:test"
import assert from "node:assert/strict"
import { isNearBottom, endScrollOffset, FOLLOW_BOTTOM_MAX_OFFSET } from "./scroll-follow.ts"

test("the bottom is the end of a plain transcript", () => {
  // 2000 px viewport, 3000 px content: the bottom means offset 1000.
  assert.equal(isNearBottom(1000, 2000, 3000), true)
  assert.equal(isNearBottom(1000 - FOLLOW_BOTTOM_MAX_OFFSET, 2000, 3000), true)
})

test("a reader a little further up is no longer following", () => {
  assert.equal(isNearBottom(1000 - FOLLOW_BOTTOM_MAX_OFFSET - 1, 2000, 3000), false)
  assert.equal(isNearBottom(0, 2000, 3000), false)
})

test("content shorter than the viewport always counts as the bottom", () => {
  assert.equal(isNearBottom(0, 2000, 800), true)
})

// scrollToEnd uses the last row's measured frame, which lags the chunk that
// just arrived during streaming; the content size in the event is already the
// real end, so following has to use it directly.
test("the end offset comes from the content size, not a row frame", () => {
  assert.equal(endScrollOffset(3000, 2000), 1000)
  assert.equal(endScrollOffset(800, 2000), 0)
  assert.equal(endScrollOffset(0, 0), 0)
})

test("before the first measurement the list counts as the bottom", () => {
  // A session opens at the newest message; an unmeasured content must not read
  // as "the reader is far away" and suppress following.
  assert.equal(isNearBottom(0, 0, 0), true)
  assert.equal(isNearBottom(0, 2000, 0), true)
})
