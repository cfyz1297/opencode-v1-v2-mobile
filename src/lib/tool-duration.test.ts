import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { formatToolDuration } from "./tool-duration.ts"

describe("formatToolDuration", () => {
  it("formats a finished tool", () => {
    assert.equal(formatToolDuration(1000, 12_300), "11.3s")
  })

  it("measures a running tool against the caller's clock", () => {
    // The card passed no clock before, so a running tool showed nothing for
    // its whole run - a long command looked identical to a frozen app.
    assert.equal(formatToolDuration(1000, undefined, 2500), "1.5s")
  })

  it("switches to minutes so a long run cannot be mistaken for a hang", () => {
    assert.equal(formatToolDuration(0 + 1, undefined, 1 + 305_000), "5m 05s")
  })

  it("returns nothing without a start or before it", () => {
    assert.equal(formatToolDuration(undefined, 5000), null)
    assert.equal(formatToolDuration(5000, undefined, undefined), null)
    assert.equal(formatToolDuration(5000, 4000), null)
  })

  it("keeps sub-second runs readable", () => {
    assert.equal(formatToolDuration(1000, 1400), "400ms")
  })
})
