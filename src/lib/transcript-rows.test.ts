import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildTranscriptRows,
  rowChrome,
  rowMessage,
  rowMessages,
  rowParts,
  userRowIds,
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

test("a question ends the run at the step that asked it", () => {
  // Newest-first store order. The answered card is drawn under the row, so
  // the row has to end at the message that asked — otherwise the card sinks
  // to the bottom of the whole run, far below the text the user answered.
  const rows = buildTranscriptRows(
    [item("a3", "assistant"), item("a2", "assistant"), item("a1", "assistant")],
    (id) => id === "a2",
  )
  assert.deepEqual(
    rows.map((row) => (row.kind === "run" ? row.items.map((i) => i.message.id) : [row.id])),
    [
      ["a3"],
      ["a2", "a1"],
    ],
  )
  // The newest question of a run needs no extra row: the card after the run
  // already sits where it was asked.
  const live = buildTranscriptRows(
    [item("a3", "assistant"), item("a2", "assistant")],
    (id) => id === "a3",
  )
  assert.equal(live.length, 1)
})

// The navigator walks the user's own messages: a question is a stable anchor,
// while assistant rows grow, merge and stream. These two helpers are the whole
// "which question am I reading" rule.
function userRow(id: string): TranscriptItem {
  return item(id, "user")
}
function assistantRow(id: string): TranscriptItem {
  return item(id, "assistant", [{ type: "text", text: "answer" }])
}

test("userRowIds lists only the user's own rows, newest first", () => {
  const rows = buildTranscriptRows([
    assistantRow("a3"),
    assistantRow("a2"),
    userRow("u2"),
    assistantRow("a1"),
    userRow("u1"),
  ])
  // A merged assistant run is one row and never a target.
  assert.deepEqual(userRowIds(rows), ["u2", "u1"])
})

// List order (oldest first): a run split at a question is two rows in a row.
test("a chunk that continues a run above hides its header, but a user row never does", () => {
  const rows = buildTranscriptRows([item("u2", "user"), item("a3", "assistant"), item("a2", "assistant")])
  const listRows = [...rows].reverse()
  // listRows: [u2, run(a2..a3)] — the user row follows nothing and must keep
  // its "You" header; a positional check would have hidden it.
  assert.deepEqual(rowChrome(listRows, 0), { continued: false, showMeta: true })
  assert.deepEqual(rowChrome(listRows, 1), { continued: false, showMeta: true })
})

test("the older chunk of a split run is continued and shows no footer", () => {
  const older = buildTranscriptRows(
    [item("a4", "assistant"), item("a3", "assistant"), item("a2", "assistant")],
    (id) => id === "a2",
  )
  // Store order is newest first; list order is oldest first.
  const split = [...older].reverse()
  assert.deepEqual(
    split.map((row) => (row.kind === "run" ? row.items.map((i) => i.message.id) : [row.id])),
    [["a2"], ["a4", "a3"]],
  )
  assert.deepEqual(rowChrome(split, 0), { continued: false, showMeta: false })
  // The second row continues the split run: no repeated header, and it ends
  // the run so it carries the token/cost footer.
  assert.deepEqual(rowChrome(split, 1), { continued: true, showMeta: true })
})




