import { test } from "node:test"
import assert from "node:assert/strict"
import { isNearBottom, followScrollOffset, FOLLOW_TO_END, FOLLOW_BOTTOM_MAX_OFFSET } from "./scroll-follow.ts"

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

// A measured end lags the streaming chunk that just arrived: the height event
// fires for the layout the chunk produced, but by the time the scroll lands
// the text has grown again. Android clips the command to the real content, so
// aiming past the end is the only exact answer there.
test("following aims past the end on Android and measures elsewhere", () => {
  assert.equal(followScrollOffset(3000, 2000, "android"), FOLLOW_TO_END)
  assert.equal(followScrollOffset(0, 0, "android"), FOLLOW_TO_END)
  assert.equal(followScrollOffset(3000, 2000, "ios"), 1000)
  assert.equal(followScrollOffset(800, 2000, "ios"), 0)
  assert.equal(followScrollOffset(3000, 0, "ios"), null, "unmeasured viewport has no arithmetic answer")
  // The constant must survive the density conversion inside an int.
  assert.ok(FOLLOW_TO_END * 4 < 2 ** 31)
})

test("before the first measurement the list counts as the bottom", () => {
  // A session opens at the newest message; an unmeasured content must not read
  // as "the reader is far away" and suppress following.
  assert.equal(isNearBottom(0, 0, 0), true)
  assert.equal(isNearBottom(0, 2000, 0), true)
})
