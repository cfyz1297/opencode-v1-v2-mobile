// Behaviour of the transcript navigator that the upstream test file does not
// cover: what happens when the native offset and our expectation disagree, and
// what happens when the target row has not been measured yet.
//
// The reported bug: tapping "up" moved the counter (3/5 → 2/5) but the
// transcript stayed at the bottom. Two causes are pinned here — a programmatic
// scroll whose expected offset never matched froze the tracked position, and a
// seek with an unknown viewport height computed a zero-pixel scroll.
import { test } from "node:test"
import assert from "node:assert/strict"
import { MessageNavigation } from "./message-navigation.ts"

// Inverted list: content coordinate 0 is the newest message (the visual
// bottom); a larger offset is further back in history. The viewport shows
// [offset, offset + height].
class FakeList {
  offset = 0
  frames = new Map<string, { y: number; height: number }>()
  calls: Array<{ kind: "offset" | "index"; value: number }> = []

  constructor(ids: string[], height: number, known = ids.length) {
    let y = 0
    for (const id of ids) {
      if (known > 0) this.frames.set(id, { y, height })
      y += height
      known--
    }
  }

  // Rows that mount later report their frames the way onLayout does.
  mount(from: number, count: number, idOf: (index: number) => string, height: number) {
    let y = from * height
    for (let i = 0; i < count; i++) {
      this.frames.set(idOf(from + i), { y, height })
      y += height
    }
  }

  scrollToOffset({ offset }: { offset: number }) {
    this.calls.push({ kind: "offset", value: offset })
    this.offset = offset
  }

  scrollToIndex({ index }: { index: number; viewPosition?: number; animated?: boolean }) {
    this.calls.push({ kind: "index", value: index })
    const frame = this.frames.get([...this.frames.keys()][index])
    if (frame) this.offset = frame.y
  }
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`)

test("one tap scrolls the transcript, not just the counter", () => {
  const list = new FakeList(ids(5), 100)
  const nav = new MessageNavigation()
  nav.sync(ids(5))
  for (const [id, frame] of list.frames) nav.frames.set(id, frame)
  nav.observe(0, 300)

  nav.move(1)
  nav.seek(list, 0)
  assert.ok(list.offset > 0, `the list must actually move, got offset ${list.offset}`)
  assert.equal(nav.current(), 3, "the position follows the target that was scrolled to")
})

test("a collapsed viewport does not turn the retry into a 0 px scroll", () => {
  const nav = new MessageNavigation()
  nav.sync(ids(6))
  const list = new FakeList(ids(6), 100, 3)
  for (const [id, frame] of list.frames) nav.frames.set(id, frame)
  nav.observe(0, 300)

  nav.move(1)
  nav.move(1)
  nav.move(1)
  // The list reports height 0 for a moment while the keyboard opens; a
  // relative step of 0.8 * 0 is 0 px, so the retry must jump to the index.
  nav.observe(0, 0)
  const retry = nav.seek(list, 1)
  assert.equal(retry, true, "the seek must keep trying")
  assert.ok(
    list.calls.some(call => call.kind === "index"),
    "with a collapsed viewport the seek falls back to scrollToIndex",
  )
})

test("the second attempt lands once the target row is measured", () => {
  const nav = new MessageNavigation()
  nav.sync(ids(6))
  const list = new FakeList(ids(6), 100, 3)
  for (const [id, frame] of list.frames) nav.frames.set(id, frame)
  nav.observe(0, 300)

  for (let i = 0; i < 3; i++) nav.move(1)
  nav.seek(list, 0)
  // The list mounted the new rows and reports their frames.
  list.mount(0, 6, index => ids(6)[index], 100)
  for (const [id, frame] of list.frames) nav.frames.set(id, frame)
  nav.seek(list, 1)

  const offset = list.calls.filter(call => call.kind === "offset").at(-1)
  assert.ok(offset && offset.value > 0, "the retry scrolls to the measured target")
  assert.equal(nav.target, undefined, "and the seek completes")
})

test("manual scrolling re-anchors from the real viewport", () => {
  const nav = new MessageNavigation()
  nav.sync(ids(5))
  for (const [index, id] of ids(5).entries()) nav.frames.set(id, { y: index * 100, height: 100 })
  nav.observe(0, 300)
  nav.move(1)
  nav.complete(100)

  nav.manual()
  nav.observe(200, 300)
  assert.equal(nav.current(), 4, "after a manual scroll the position is what is on screen")
})
