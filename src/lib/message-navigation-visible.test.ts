import { test } from "node:test"
import assert from "node:assert/strict"
import { MessageNavigation } from "./message-navigation.ts"

const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`)

// The navigator positions itself from the rows it measured. Only user messages
// are measured (few, stable height), so these frames describe a transcript of
// questions with answers in between. Plain list: y grows downward from the
// oldest row, so each frame starts one row after the previous one.
function withFrames(nav: MessageNavigation, ys: number[], height = 600) {
  nav.sync(ids(ys.length))
  ys.forEach((y, index) => nav.frames.set(`u${index}`, { y, height }))
}

// Reported bug: the counter read the wrong position while the viewport sat at
// the top of the session, and the buttons did nothing until the transcript was
// scrolled by hand. Both came from the position being unknown: it was only ever
// set by a scroll report, and nothing scrolls on mount.
test("the position comes from the measured rows, not from a scroll callback", () => {
  const nav = new MessageNavigation()
  withFrames(nav, [0, 600, 1200, 1800, 2400])
  // Viewport at the top, where the session is read from.
  nav.observe(0, 500)
  assert.equal(nav.current(), 0, "the oldest question is where the viewport starts")

  // Scrolled to the bottom: the newest question.
  nav.observe(2500, 500)
  assert.equal(nav.current(), 4, "the newest question is where the viewport ends up")

  nav.observe(1300, 500)
  assert.equal(nav.current(), 2, "and every position in between resolves to its question")
})

test("the question that owns the visible answer stays current", () => {
  const nav = new MessageNavigation()
  // u0 oldest at the top of the content; a long answer sits below it.
  withFrames(nav, [0, 2000], 600)
  // Viewport top edge inside the answer that follows u0.
  nav.observe(1500, 500)
  assert.equal(nav.current(), 0, "reading an answer means reading its question")
  // Past the newer question.
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

test("the content's top padding does not hide the first question", () => {
  // The content container has 16 px of top padding, so at offset 0 no frame
  // starts at y = 0 — the row is found by the "first row below the edge" branch.
  const nav = new MessageNavigation()
  withFrames(nav, [16, 616, 1216])
  nav.observe(0, 500)
  assert.equal(nav.current(), 0, "opening a session reads as the oldest loaded question")
})

test("a jump owns the position until the viewport reports back", () => {
  const nav = new MessageNavigation()
  withFrames(nav, [0, 600, 1200])
  nav.jumpTo("u1")
  // The list's own viewability report must not steal the position mid-jump.
  nav.setCurrent("u2")
  assert.equal(nav.current(), 1)
  nav.release()
  nav.setCurrent("u2")
  assert.equal(nav.current(), 2)
})

test("only the rows that are measured participate", () => {
  const nav = new MessageNavigation()
  nav.sync(ids(3))
  // Nothing measured yet: no position is better than a wrong one.
  nav.observe(0, 500)
  assert.equal(nav.current(), -1)
  nav.frames.set("u2", { y: 900, height: 600 })
  assert.equal(nav.current(), 2, "the only measured row is the only candidate")
})

test("an unmeasured transcript has no position at all", () => {
  const nav = new MessageNavigation()
  nav.observe(0, 500)
  assert.equal(nav.current(), -1, "nothing measured means no position to report")
  assert.equal(nav.move(1), undefined)
})
