// The aggregate formatter exists because the collapsed run header passed 0 as
// a start timestamp — which formatToolDuration treats as "no data" — so the
// total time silently disappeared. These pin the boundary cases.
import { test } from "node:test"
import assert from "node:assert/strict"
import { formatDurationMs, formatToolDuration } from "./tool-duration.ts"

test("zero milliseconds is a real duration, not missing data", () => {
  assert.equal(formatDurationMs(0), "0ms")
})

test("sub-second totals read in milliseconds", () => {
  assert.equal(formatDurationMs(1), "1ms")
  assert.equal(formatDurationMs(999), "999ms")
})

test("seconds keep one decimal, minutes read as m ss", () => {
  assert.equal(formatDurationMs(1000), "1.0s")
  assert.equal(formatDurationMs(12_340), "12.3s")
  assert.equal(formatDurationMs(125_000), "2m 05s")
})

test("nonsense input is rejected instead of printed", () => {
  assert.equal(formatDurationMs(-5), null)
  assert.equal(formatDurationMs(Number.NaN), null)
})

test("the per-tool formatter still needs a start", () => {
  assert.equal(formatToolDuration(undefined, 100), null, "no start is no duration")
  assert.equal(formatToolDuration(1000, 3000), "2.0s")
  assert.equal(formatToolDuration(1000, undefined, 4000), "3.0s", "a running tool counts to now")
  assert.equal(formatToolDuration(5000, 4000), null, "an end before the start is broken data")
})
