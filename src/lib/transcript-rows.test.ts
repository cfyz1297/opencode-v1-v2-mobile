import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildTranscriptRows,
  rowMessage,
  rowMessages,
  rowParts,
  type TranscriptItem,
} from "./transcript-rows.ts"
import type { Part } from "./sdk.ts"

function item(id: string, role: string, parts: Array<Partial<Part>> = []): TranscriptItem {
  return {
    message: { id, sessionID: "s", role, time: { created: 1 } } as TranscriptItem["message"],
    parts: parts.map((part, i) => ({ id: `${id}-p${i}`, messageID: id, type: "text", ...part }) as Part),
  }
}

// The store hands the list newest first.
test("consecutive assistant steps become one row", () => {
  const rows = buildTranscriptRows([
    item("a3", "assistant"),
    item("a2", "assistant"),
    item("a1", "assistant"),
    item("u1", "user"),
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].kind, "run")
  assert.equal(rows[0].kind === "run" && rows[0].items.length, 3)
  assert.equal(rows[1].kind, "single")
})

test("a user message breaks the run in both directions", () => {
  const rows = buildTranscriptRows([
    item("a3", "assistant"),
    item("u2", "user"),
    item("a1", "assistant"),
    item("u1", "user"),
  ])
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["run", "single", "run", "single"],
  )
})

test("a run's id is its oldest message so it survives new steps", () => {
  const before = buildTranscriptRows([item("a2", "assistant"), item("a1", "assistant")])
  // A new step arrives at the newest end; the row keeps the id the list
  // already knows, so navigation anchors and keys do not jump.
  const after = buildTranscriptRows([item("a3", "assistant"), item("a2", "assistant"), item("a1", "assistant")])
  assert.equal(before[0].id, "a1")
  assert.equal(after[0].id, "a1")
})

test("the row's index points at its newest message for run totals", () => {
  const rows = buildTranscriptRows([
    item("a3", "assistant"),
    item("a2", "assistant"),
    item("u1", "user"),
    item("a1b", "assistant"),
  ])
  assert.deepEqual(
    rows.map((row) => row.index),
    [0, 2, 3],
  )
})

test("parts are read oldest first, across the whole run", () => {
  const rows = buildTranscriptRows([
    item("a2", "assistant", [{ text: "second" }]),
    item("a1", "assistant", [{ text: "first" }, { text: "also first" }]),
  ])
  assert.deepEqual(
    rowParts(rows[0]).map((part) => part.text),
    ["first", "also first", "second"],
  )
  // A single row keeps its parts array by reference (memo-friendly).
  const single = buildTranscriptRows([item("u1", "user", [{ text: "hi" }])])
  assert.equal(rowParts(single[0]), single[0].kind === "single" && single[0].item.parts)
})

test("the newest message of a run carries the chrome", () => {
  const rows = buildTranscriptRows([
    item("a2", "assistant"),
    item("a1", "assistant"),
    item("u1", "user"),
  ])
  assert.equal(rowMessage(rows[0]).id, "a2")
  assert.equal(rowMessage(rows[1]).id, "u1")
  assert.deepEqual(
    rowMessages(rows[0]).map((message) => message.id),
    ["a2", "a1"],
  )
})

test("an empty transcript has no rows", () => {
  assert.deepEqual(buildTranscriptRows([]), [])
})
