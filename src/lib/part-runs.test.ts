import { test } from "node:test"
import assert from "node:assert/strict"
import { groupParts, isCommandRun } from "./part-runs.ts"
import type { Part } from "./sdk.ts"

function part(type: Part["type"], extra: Partial<Part> = {}): Part {
  return { id: `${type}-${Math.random()}`, messageID: "m", type, ...extra }
}

test("groupParts keeps the model's order instead of regrouping by type", () => {
  const parts = [
    part("reasoning", { text: "plan" }),
    part("text", { text: "answer" }),
    part("tool", { tool: "shell" }),
    part("reasoning", { text: "next" }),
    part("tool", { tool: "shell" }),
  ]
  // Text is the only hard boundary: everything a step did between two answers
  // is one activity block, so the transcript reads answer / activity / answer.
  assert.deepEqual(
    groupParts(parts).map((item) => item.kind),
    ["activity", "text", "activity"],
  )
})

test("groupParts folds reasoning split by tool calls into one block", () => {
  const items = groupParts([
    part("reasoning", { text: "first" }),
    part("tool", { tool: "shell" }),
    part("reasoning", { text: "second" }),
    part("tool", { tool: "shell" }),
    part("text", { text: "done" }),
  ])
  assert.deepEqual(
    items.map((item) => item.kind),
    ["activity", "text"],
  )
  const activity = items[0]
  assert.equal(activity.kind === "activity" && activity.reasoning?.text, "first\n\nsecond")
  // A merged block spans several steps, so a per-block duration would lie.
  assert.equal(activity.kind === "activity" && activity.reasoning?.time, undefined)
  assert.equal(activity.kind === "activity" && activity.tools.length, 2)
})

test("groupParts folds consecutive tool calls into one run", () => {
  const tools = [part("tool", { tool: "bash" }), part("tool", { tool: "bash" }), part("tool", { tool: "read" })]
  const items = groupParts([part("text", { text: "go" }), ...tools])
  assert.equal(items.length, 2)
  assert.equal(items[1].kind, "activity")
  assert.equal(items[1].kind === "activity" && items[1].tools.length, 3)
  // No reasoning in this segment: the block is tools-only.
  assert.equal(items[1].kind === "activity" && items[1].reasoning, undefined)
})

test("groupParts does not join tool calls split by text", () => {
  const items = groupParts([
    part("tool", { tool: "bash" }),
    part("text", { text: "between" }),
    part("tool", { tool: "bash" }),
  ])
  // The answer between them explains why the next batch started.
  assert.deepEqual(
    items.map((item) => item.kind),
    ["activity", "text", "activity"],
  )
})

test("groupParts drops bookkeeping and empty parts", () => {
  const items = groupParts([
    part("step-start"),
    part("text", { text: "" }),
    part("reasoning"),
    part("snapshot"),
    part("file", { mime: "image/png" }),
    part("text", { text: "kept" }),
  ])
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, "text")
})

test("groupParts on an empty list is empty", () => {
  assert.deepEqual(groupParts([]), [])
})

test("an activity block carries its own id so it can keep expand state", () => {
  const items = groupParts([part("tool", { tool: "shell", id: "tool-1" })])
  assert.equal(items[0].kind === "activity" && items[0].key, "tool-1")
})

test("isCommandRun is true only for shell-only runs", () => {
  assert.equal(isCommandRun([part("tool", { tool: "bash" })]), true)
  // V2 renamed the tool: real runs report `shell`, which used to fall through
  // to the generic "Ran N tools" label.
  assert.equal(isCommandRun([part("tool", { tool: "shell" })]), true)
  assert.equal(isCommandRun([part("tool", { tool: "shell" }), part("tool", { tool: "read" })]), false)
  assert.equal(isCommandRun([]), false)
})
