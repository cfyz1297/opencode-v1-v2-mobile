import { test } from "node:test"
import assert from "node:assert/strict"
import { nextRunStart } from "./run-clock.ts"

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
