// The status bar is the only proof that a run is still alive while the model
// thinks. It is rendered under RN, so its wiring is pinned at the source level:
// the shared clock must be started from the run's own start, and its value must
// reach the label. Without these the bar goes back to a frozen "Working…".
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const source = readFileSync(new URL("./StatusIndicator.tsx", import.meta.url), "utf8")

test("the status bar counts from the run's first busy event", () => {
  assert.match(source, /useTickingNow\(busy, startedAt\)/, "the shared clock must drive the bar")
  assert.match(source, /runStartedAt\[sessionID\]/, "the start comes from the event store")
})

test("the elapsed time reaches the label", () => {
  assert.match(source, /formatDurationMs\(elapsedMs\)/, "the elapsed time must be formatted")
  assert.match(source, /\{elapsed \?/, "the label must append the elapsed time")
})
