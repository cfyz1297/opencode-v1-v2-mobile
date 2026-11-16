import { test } from "node:test"
import assert from "node:assert/strict"
import { disconnectReasonText } from "./disconnect-reason.ts"

test("drops the redundant Error: prefix", () => {
  assert.equal(disconnectReasonText(new Error("SSE stream closed (code 1006)")), "SSE stream closed (code 1006)")
})

test("keeps a plain string and a non-Error reason readable", () => {
  assert.equal(disconnectReasonText("fetch failed"), "fetch failed")
  assert.equal(disconnectReasonText(401), "401")
})

test("caps a verbose transport error so the banner stays one line", () => {
  const text = disconnectReasonText(new Error("x".repeat(500)))
  assert.equal(text.length, 200)
})
