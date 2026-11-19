import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldFollowBottom, frameShift, contentGrowthAction, FOLLOW_BOTTOM_MAX_OFFSET } from "./scroll-follow.ts"

test("the newest end is the bottom of an inverted transcript", () => {
  assert.equal(shouldFollowBottom(0), true)
  assert.equal(shouldFollowBottom(FOLLOW_BOTTOM_MAX_OFFSET), true)
})

test("scrolled up stops auto-following", () => {
  assert.equal(shouldFollowBottom(FOLLOW_BOTTOM_MAX_OFFSET + 1), false)
  assert.equal(shouldFollowBottom(1500), false)
})

// The measured displacement of the reader's rows, in either direction.
test("a row that moved reports how far", () => {
  assert.equal(frameShift(400, 460), 60)
  assert.equal(frameShift(400, 400), 0)
})

test("content that shrank moves the reading position back", () => {
  assert.equal(frameShift(600, 560), -40)
})

test("first measurement and sub-pixel jitter are not movement", () => {
  assert.equal(frameShift(undefined, 300), 0)
  assert.equal(frameShift(300, 300.4), 0)
})

// The decision the transcript runs on every content-size event. Every branch
// below broke a shipped build at least once, so each case is pinned.
const idle = { atBottom: false, held: false, dragging: false, grown: 0 }

test("at the newest end the list pins to the stream", () => {
  assert.deepEqual(contentGrowthAction({ ...idle, atBottom: true }), { kind: "pin" })
})

test("a navigator tap at the newest end keeps its position", () => {
  assert.deepEqual(contentGrowthAction({ ...idle, atBottom: true, held: true }), { kind: "none" })
})

test("a drag owns the position", () => {
  assert.deepEqual(contentGrowthAction({ ...idle, atBottom: true, dragging: true }), { kind: "none" })
  assert.deepEqual(contentGrowthAction({ ...idle, dragging: true, grown: 40 }), { kind: "none" })
})

test("reading up the transcript shifts by the measured movement", () => {
  assert.deepEqual(contentGrowthAction({ ...idle, grown: 40 }), { kind: "shift", by: 40 })
})

test("a growing answer cannot move the list while nobody reads up there", () => {
  assert.deepEqual(contentGrowthAction({ ...idle, atBottom: true, grown: 400 }), { kind: "pin" })
})

test("no movement leaves the offset alone", () => {
  assert.deepEqual(contentGrowthAction({ ...idle, grown: 0 }), { kind: "none" })
})
