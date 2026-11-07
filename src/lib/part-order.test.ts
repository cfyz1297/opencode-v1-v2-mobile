// Regression pin for "the answer is already in the chat, then it starts typing
// itself again": V2 sends the whole accumulated text with every delta, and the
// socket backlog drained after a resume can be older than the transcript the
// app just fetched. Text only grows while a run streams, so a shorter snapshot
// must never replace a longer one.
import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldApplyPartUpdate } from "./part-order.ts"
import type { Part } from "./sdk.ts"

const text = (value: string): Part => ({
  id: "a1_text0",
  messageID: "a1",
  sessionID: "s1",
  type: "text",
  text: value,
})

test("a stale shorter text snapshot cannot overwrite the complete answer", () => {
  assert.equal(shouldApplyPartUpdate(text("Полный ответ."), text("Пол")), false)
})

test("a newer longer delta still lands", () => {
  assert.equal(shouldApplyPartUpdate(text("Пол"), text("Полный ответ.")), true)
  assert.equal(shouldApplyPartUpdate(text("same"), text("same")), true)
})

test("a started event (empty text) always lands, so a replayed run can reset", () => {
  assert.equal(shouldApplyPartUpdate(text("old run"), text("")), true)
})

test("reasoning parts follow the same rule", () => {
  const reasoning = (value: string): Part => ({ ...text(value), type: "reasoning" })
  assert.equal(shouldApplyPartUpdate(reasoning("full thought"), reasoning("full")), false)
})

test("non-text parts always replace — tool state is not append-only", () => {
  const running: Part = {
    id: "tc_1",
    messageID: "a1",
    type: "tool",
    tool: "shell",
    callID: "1",
    state: { status: "running", input: {} },
  }
  const done: Part = { ...running, state: { status: "completed" } }
  assert.equal(shouldApplyPartUpdate(running, done), true)
  assert.equal(shouldApplyPartUpdate(done, running), true)
})

test("a part that is not in the store yet always lands", () => {
  assert.equal(shouldApplyPartUpdate(undefined, text("first")), true)
})
