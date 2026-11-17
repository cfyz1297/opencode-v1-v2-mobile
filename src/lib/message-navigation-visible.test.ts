import { test } from "node:test"
import assert from "node:assert/strict"
import { MessageNavigation } from "./message-navigation.ts"

const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`)

// The list reports which rows are actually on screen. Deriving the position
// from measured frames alone was wrong after a fling: rows outside the render
// window have no fresh frame, so the counter said "12 / 12" (newest) while the
// viewport sat on old messages, and a tap then seeked from the wrong base.
test("a reported visible row is the position, not the frame math", () => {
  const nav = new MessageNavigation()
  nav.sync(ids(12))
  nav.observe(2000, 400)
  nav.setCurrent("m8")
  assert.equal(nav.current(), 8)
  assert.equal(nav.move(1), 9, "one tap moves one message from what is on screen")
})

test("the reported row survives a streaming append", () => {
  const nav = new MessageNavigation()
  nav.sync(ids(12))
  nav.setCurrent("m8")
  // A new message arrives at the newest end, so every index shifts by one.
  nav.sync(["mNew", ...ids(12)])
  assert.equal(nav.current(), 9, "the same message keeps the position")
})

test("a manual scroll can take the position back", () => {
  const nav = new MessageNavigation()
  nav.sync(ids(12))
  nav.setCurrent("m8")
  // The screen calls manual() on drag begin, then reports what is visible.
  nav.manual()
  nav.observe(2400, 400)
  nav.setCurrent("m10")
  assert.equal(nav.current(), 10)
})

test("a completed seek reports the target", () => {
  const nav = new MessageNavigation()
  nav.sync(ids(6))
  nav.setCurrent("m1")
  const list = { scrollToOffset() {}, scrollToIndex() {} }
  nav.move(1)
  nav.complete(1200)
  assert.equal(nav.current(), 2, "the target becomes the position after the seek")
})

test("a row the list no longer knows is ignored", () => {
  const nav = new MessageNavigation()
  nav.sync(ids(4))
  nav.setCurrent("gone")
  assert.notEqual(nav.current(), -2, "an unknown id must not poison the navigation")
})

// A navigator jump lands the target in the middle of the viewport, so the
// topmost visible row is one or two rows *above* it. Letting viewability win
// made one tap skip several messages: the counter went 6/12 → 3/12.
test("a held position is not overridden by what the list reports", () => {
  const nav = new MessageNavigation()
  nav.sync(ids(12))
  nav.setCurrent("m8")
  nav.hold()
  nav.setCurrent("m5")
  assert.equal(nav.current(), 8, "the jumped-to message stays current")
})

test("a manual scroll takes the position back after a jump", () => {
  const nav = new MessageNavigation()
  nav.sync(ids(12))
  nav.setCurrent("m8")
  nav.hold()
  nav.release()
  nav.setCurrent("m5")
  assert.equal(nav.current(), 5)
})

test("holding does not affect the jump target itself", () => {
  const nav = new MessageNavigation()
  nav.sync(ids(12))
  nav.setCurrent("m8")
  nav.hold()
  assert.equal(nav.move(1), 9, "taps keep working while the position is held")
})
