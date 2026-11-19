import type { Message, Part } from "./sdk"

/** One entry of the transcript store, as the list receives it (newest first). */
export interface TranscriptItem {
  message: Message
  parts: Part[]
}

/**
 * One row of the transcript list, newest first.
 *
 * A tool-using turn arrives as one assistant message per step. Drawing each of
 * them as its own bubble repeated the header, the activity spoiler and the
 * token footer once per step, so a ten-step turn filled the screen with
 * "Steps: 1" rows. Consecutive assistant messages are therefore one render row:
 * their parts are read in order and the spoiler counts the whole segment.
 */
export type TranscriptRow =
  | { kind: "single"; id: string; index: number; item: TranscriptItem }
  | {
      kind: "run"
      // The oldest message of the run: a run grows at its newest end, so this
      // id stays stable for list keys, navigation anchors and measurement.
      id: string
      // Index of the newest message, for the run totals (see runTotals).
      index: number
      items: TranscriptItem[]
    }

export function buildTranscriptRows(items: TranscriptItem[]): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  items.forEach((item, index) => {
    if (item.message.role !== "assistant") {
      rows.push({ kind: "single", id: item.message.id, index, item })
      return
    }
    const last = rows[rows.length - 1]
    if (last?.kind === "run") {
      last.items.push(item)
      last.id = item.message.id
      return
    }
    rows.push({ kind: "run", id: item.message.id, index, items: [item] })
  })
  return rows
}

/** Parts in reading order (oldest first) — the order the model produced them. */
export function rowParts(row: TranscriptRow): Part[] {
  if (row.kind === "single") return row.item.parts
  const parts: Part[] = []
  for (let i = row.items.length - 1; i >= 0; i--) parts.push(...row.items[i].parts)
  return parts
}

/** The newest message: it carries the freshest model, error and usage. */
export function rowMessage(row: TranscriptRow): Message {
  return row.kind === "single" ? row.item.message : row.items[0].message
}

/** Every message the row draws, newest first — questions are placed per id. */
export function rowMessages(row: TranscriptRow): Message[] {
  return row.kind === "single" ? [row.item.message] : row.items.map((item) => item.message)
}

/** True for a row that is one of the user's own messages. */
function isUserRow(row: TranscriptRow): boolean {
  return row.kind === "single" && row.item.message.role === "user"
}

/**
 * The navigator's targets: the user's own messages, in the order the list
 * renders them (oldest first).
 *
 * A question is a stable anchor — it never streams, never merges and never
 * changes height — while assistant rows grow and re-merge, which is what made
 * the counter and the jumps unreliable.
 */
export function userRowIds(rows: TranscriptRow[]): string[] {
  return rows.filter(isUserRow).map((row) => row.id)
}
