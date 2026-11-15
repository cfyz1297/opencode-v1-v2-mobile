// The row that shows a delegated subagent must tell "still working" from
// "finished" without the parent tool part, which completes at dispatch time.
import { test } from "node:test"
import assert from "node:assert/strict"
import { collectSubagents, deriveSubagentStatus, orderSubagents, summarizeSubagents } from "./subagent-status.ts"

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

const part = (child: string, index = 1) => ({
  type: "tool",
  tool: "subagent",
  sessionID: "parent-1",
  state: { input: { agent: "general", description: `task ${index}` }, metadata: { sessionID: child } },
})

test("the bar lists every delegated subagent in call order", () => {
  const refs = collectSubagents([
    { parts: [part("c1", 1), { type: "text" }] },
    { parts: [part("c2", 2)] },
    // A retried part must not add a duplicate row.
    { parts: [part("c1", 1)] },
  ])
  assert.deepEqual(refs.map((r) => r.sessionID), ["c1", "c2"])
  assert.equal(refs[0].parentID, "parent-1")
  assert.equal(refs[1].title, "task 2")
})

test("a running subagent is never buried under finished ones", () => {
  const refs = collectSubagents([
    { parts: [part("c1", 1), part("c2", 2), part("c3", 3)] },
  ])
  const ordered = orderSubagents(refs, (ref) => (ref.sessionID === "c3" ? "running" : "done"))
  assert.deepEqual(ordered.map((r) => r.sessionID), ["c3", "c1", "c2"])
})
