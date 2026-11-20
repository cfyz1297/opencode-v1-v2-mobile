import { test } from "node:test"
import assert from "node:assert/strict"
import { sessionsWithoutStatus } from "./active-sessions.ts"

test("a cold start adopts every run the server reports", () => {
  assert.deepEqual(sessionsWithoutStatus(["s1", "s2"], {}), ["s1", "s2"])
})

test("sessions the app already has a status for are left alone", () => {
  const missing = sessionsWithoutStatus(["running", "known-busy", "known-idle"], {
    "known-busy": { type: "busy" },
    "known-idle": { type: "idle" },
  })
  assert.deepEqual(missing, ["running"])
})

test("duplicates are reported once and nothing is invented", () => {
  assert.deepEqual(sessionsWithoutStatus(["s1", "s1"], {}), ["s1"])
  assert.deepEqual(sessionsWithoutStatus([], {}), [])
})
