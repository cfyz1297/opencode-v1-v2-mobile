import { test } from "node:test"
import assert from "node:assert/strict"
import { MessageNavigation } from "./message-navigation.ts"

const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`)

// The navigator positions itself from the rows it measured. Only user messages
// are measured (few, stable height), so these frames describe a transcript of
// questions with answers in between.
function withFrames(nav: MessageNavigation, ys: number[], height = 100) {
  nav.sync(ids(ys.length))
  ys.forEach((y, index) => nav.frames.set(`u${index}`, { y, height }))
}

// Reported bug: the counter read "5 / 5" while the viewport sat at the top of
// the session, and the buttons did nothing until the transcript was scrolled by
// hand. Both came from the position being unknown: it was only ever set by the
// list's viewability callback, which does not fire on an inverted list until
// something scrolls.
test("the position comes from the measured rows, not from a scroll callback", () => {
  const nav = new MessageNavigation()
  withFrames(nav, [0, 600, 1200, 1800, 2400])
  // Viewport at the visual bottom: inverted offset 0 shows the newest content.
  nav.observe(0, 500)
  assert.equal(nav.current(), 0, "opening a session reads as the newest question")

  // Scrolled to the top: offset grows toward older content.
  nav.observe(2500, 500)
  assert.equal(nav.current(), 4, "the oldest question is where the viewport ends up")

  nav.observe(1300, 500)
  assert.equal(nav.current(), 2, "and every position in between resolves to its question")
})

test("the question that owns the visible answer stays current", () => {
  const nav = new MessageNavigation()
  // u0 newest at the bottom of the content; a long answer sits above it.
  withFrames(nav, [0, 2000])
  // Viewport top edge at 1500: over the answer that follows u0.
  nav.observe(1000, 500)
  assert.equal(nav.current(), 0, "reading an answer means reading its question")
  // Past the older question.
  nav.observe(2100, 500)
  assert.equal(nav.current(), 1)
})

test("a drag keeps a usable position instead of emptying it", () => {
  const nav = new MessageNavigation()
  withFrames(nav, [0, 600, 1200])
  nav.observe(600, 500)
  assert.equal(nav.current(), 1)
  // onScrollBeginDrag calls manual(): it drops the jump target and the anchor,
  // but the position must remain readable or every button tap in that window
  // does nothing.
  nav.manual()
  assert.equal(nav.current(), 1, "the position survives the start of a drag")
})

test("an unmeasured transcript has no position at all", () => {
  const nav = new MessageNavigation()
  nav.sync(ids(3))
  nav.observe(0, 500)
  assert.equal(nav.current(), -1, "no frames means unknown, not a guess")
})

test("a jump owns the position until the next report", () => {
  const nav = new MessageNavigation()
  withFrames(nav, [0, 600, 1200])
  nav.jumpTo("u2")
  assert.equal(nav.current(), 2, "the jumped-to question is current")
  nav.observe(600, 500)
  nav.manual()
  assert.equal(nav.current(), 1, "after the drag the viewport decides again")
})

test("only the rows that are measured participate", () => {
  const nav = new MessageNavigation()
  nav.sync(ids(4))
  // Only the two oldest questions have been laid out.
  nav.frames.set("u2", { y: 1200, height: 100 })
  nav.frames.set("u3", { y: 1800, height: 100 })
  nav.observe(0, 500)
  assert.equal(nav.current(), 2, "the nearest measured question is used, not a made-up index")
})
