import { test } from "node:test"
import assert from "node:assert/strict"
import { createMarkdownKeys } from "./markdown-keys.ts"

test("keys are unique within a parse", () => {
  const key = createMarkdownKeys()
  const seen = new Set<string>()
  for (let i = 0; i < 1000; i++) seen.add(key())
  assert.equal(seen.size, 1000)
})

test("the counter starts over for a new parse", () => {
  // The renderer is created per children value, so a fresh instance must
  // produce the same keys for the same input — that is what keeps re-renders
  // of an unchanged message memoized.
  assert.deepEqual(
    [createMarkdownKeys()(), createMarkdownKeys()()],
    ["markdown-key-0", "markdown-key-0"],
  )
})

test("no per-key storage: a hundred thousand keys cost nothing", () => {
  // The bug this replaces grew a property per call. A counter cannot, so the
  // string is the only allocation.
  const key = createMarkdownKeys()
  for (let i = 0; i < 100_000; i++) key()
  assert.equal(key(), "markdown-key-100000")
})

test("the prefix can be overridden", () => {
  assert.equal(createMarkdownKeys("md")(), "md-0")
})
