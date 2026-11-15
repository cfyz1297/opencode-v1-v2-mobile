// The row that shows a delegated subagent must tell "still working" from
// "finished" without the parent tool part, which completes at dispatch time.
import { test } from "node:test"
import assert from "node:assert/strict"
import { deriveSubagentStatus, summarizeSubagents } from "./subagent-status.ts"

const child = (idle?: number) => ({ time: { created: 1, updated: 2, ...(idle ? { idle } : {}) } })

test("a child with a live busy status is running even though it has no idle stamp", () => {
  assert.equal(deriveSubagentStatus(child(), { type: "busy" }, undefined), "running")
  assert.equal(deriveSubagentStatus(child(), { type: "retry" }, undefined), "running")
})

test("a child that finished before the app connected still reads as done", () => {
  // No live status after a reconnect: the idle stamp is the only evidence.
  assert.equal(deriveSubagentStatus(child(99), undefined, undefined), "done")
})

test("an error wins over a stale busy status", () => {
  assert.equal(deriveSubagentStatus(child(), { type: "busy" }, "boom"), "failed")
})

test("a child that was created but never started is idle", () => {
  assert.equal(deriveSubagentStatus(child(), { type: "idle" }, undefined), "idle")
  assert.equal(deriveSubagentStatus(undefined, undefined, undefined), "idle")
})

test("the summary counts each child exactly once", () => {
  // a: busy → running; b: idle stamp → done; c: errored → failed; d: neither → idle
  const children = [child(), child(99), child(99), child()]
  const live = { a: { type: "busy" } }
  const errors = { c: "boom" }
  const ids = ["a", "b", "c", "d"]
  const withIds = children.map((c, i) => ({ ...c, id: ids[i] }))
  assert.deepEqual(summarizeSubagents(withIds, live, errors), { running: 1, done: 1, failed: 1, idle: 1 })
})
