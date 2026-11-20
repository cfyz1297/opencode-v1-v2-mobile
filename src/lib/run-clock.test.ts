import { test } from "node:test"
import assert from "node:assert/strict"
import { newestUserMessageAt, nextRunStart, retimeRunStart } from "./run-clock.ts"

test("the first busy event starts the run clock", () => {
  assert.equal(nextRunStart(undefined, "busy", 1000), 1000)
})

test("a retry keeps the original start instead of resetting the clock", () => {
  assert.equal(nextRunStart(500, "retry", 9000), 500)
})

test("a later busy event of the same run keeps the start", () => {
  assert.equal(nextRunStart(500, "busy", 9000), 500)
})

test("idle clears the start, so the next run starts over", () => {
  assert.equal(nextRunStart(500, "idle", 9000), undefined)
  assert.equal(nextRunStart(undefined, "busy", 9000), 9000)
})

test("a newer user message re-anchors the clock to the run it belongs to", () => {
  // Socket down across the boundary: run 1 ended, run 2 began, and the server
  // still reports busy. Without the user message the clock would include run 1.
  assert.equal(retimeRunStart(500, 4000), 4000)
})

test("the same run keeps its start, however many messages it wrote", () => {
  assert.equal(retimeRunStart(500, 400), 500)
  assert.equal(retimeRunStart(500, undefined), 500)
  assert.equal(retimeRunStart(undefined, 4000), 4000)
})

test("the newest user message is the run boundary, not the newest message", () => {
  const at = newestUserMessageAt([
    { role: "assistant", time: { created: 9000 } },
    { role: "user", time: { created: 4000 } },
    { role: "user", time: { created: 3000 } },
    { role: "assistant", time: { created: 100 } },
  ])
  assert.equal(at, 4000)
  assert.equal(newestUserMessageAt([{ role: "assistant", time: { created: 9000 } }]), undefined)
  assert.equal(newestUserMessageAt([]), undefined)
})
