import { test } from "node:test"
import assert from "node:assert/strict"
import { summarizeToolActivity, toolKind } from "./tool-summary.ts"
import type { Part } from "./sdk.ts"

function tool(name: string, status: string, start?: number, end?: number): Part {
  return {
    id: `t-${name}-${Math.random()}`,
    messageID: "m",
    type: "tool",
    tool: name,
    state: { status, time: start === undefined ? undefined : { start, end } },
  } as Part
}

test("counts one entry per kind, most used first", () => {
  const summary = summarizeToolActivity([
    tool("read", "completed", 0, 1000),
    tool("shell", "completed", 0, 2000),
    tool("shell", "completed", 0, 3000),
    tool("webfetch", "completed", 0, 500),
  ])
  assert.equal(summary.count, 4)
  assert.deepEqual(summary.kinds, ["shell", "read", "webfetch"])
})

test("total time is the sum of the calls", () => {
  const summary = summarizeToolActivity([
    tool("shell", "completed", 100, 2100),
    tool("shell", "completed", 5000, 6500),
    tool("read", "completed", 9000, 9400),
  ])
  assert.equal(summary.totalMs, 2000 + 1500 + 400)
})

test("a running call counts up to now so the total moves", () => {
  const summary = summarizeToolActivity([tool("shell", "running", 1000)], 12_000)
  assert.equal(summary.totalMs, 11_000)
  assert.equal(summary.running, true)
})

test("a call that has started but not finished counts as running", () => {
  // V2 opens the window at input.started while the tool is still "pending";
  // waiting for the literal "running" status left the clock frozen exactly
  // during the phase the user watches longest.
  assert.equal(summarizeToolActivity([tool("shell", "pending", 1000)], 12_000).running, true)
})

test("a terminal state without an end stamp is not running", () => {
  assert.equal(summarizeToolActivity([tool("shell", "completed", 1000)], 12_000).running, false)
  assert.equal(summarizeToolActivity([tool("shell", "error", 1000)], 12_000).running, false)
})

test("calls without timestamps add nothing instead of skewing the total", () => {
  const summary = summarizeToolActivity([tool("shell", "completed"), tool("read", "completed", 0, 700)])
  assert.equal(summary.totalMs, 700)
})

test("failures are reported on the collapsed row", () => {
  assert.equal(summarizeToolActivity([tool("shell", "error", 0, 100)]).failed, true)
  assert.equal(summarizeToolActivity([tool("shell", "completed", 0, 100)]).failed, false)
})

test("unknown tools still appear as a generic kind", () => {
  const summary = summarizeToolActivity([tool("somethingNew", "completed", 0, 10)])
  assert.deepEqual(summary.kinds, ["tool"])
})

test("both terminal names map to one kind", () => {
  // V1 calls it bash, V2 calls it shell; counting them separately would print
  // the same word twice in the summary.
  assert.equal(toolKind("bash"), "shell")
  assert.equal(toolKind("shell"), "shell")
  assert.equal(toolKind("Bash"), "shell", "names are matched case-insensitively")
  assert.deepEqual(summarizeToolActivity([tool("bash", "completed", 0, 10), tool("shell", "completed", 0, 10)]).kinds, ["shell"])
})

test("an empty run has nothing to summarize", () => {
  const summary = summarizeToolActivity([])
  assert.deepEqual(summary, { kinds: [], count: 0, totalMs: 0, running: false, failed: false })
})
