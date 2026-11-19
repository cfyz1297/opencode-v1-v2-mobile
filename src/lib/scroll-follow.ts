// The chat transcript is an inverted FlatList: offset 0 is the newest message
// (visual bottom) and larger offsets mean the user scrolled up. New content is
// followed only while the user is at the bottom; otherwise their reading
// position would be yanked away by every streaming delta.
export const FOLLOW_BOTTOM_MAX_OFFSET = 24

export function shouldFollowBottom(offsetY: number): boolean {
  return offsetY <= FOLLOW_BOTTOM_MAX_OFFSET
}

// How far a row moved inside the content since the previous layout.
//
// Measured, not inferred: whatever grows — a streaming answer, a question card,
// a collapsed block — the rows around the reader report the same displacement,
// and that is exactly how far the scroll offset has to move to keep them still.
// Two earlier versions derived it from the newest row's height and both failed
// in the field: one hid the whole answer behind a stored follow flag, the other
// read the baseline before the delta and shifted by zero forever.
export function frameShift(prevY: number | undefined, nextY: number): number {
  if (prevY === undefined) return 0
  const delta = nextY - prevY
  // Sub-pixel jitter from text metrics is not a scroll.
  return Math.abs(delta) < 1 ? 0 : delta
}

// One correction per content-size event, taken from a single row.
//
// Every row that is pushed reports the same move, so adding them up multiplies
// the correction by the number of mounted rows — the list then jumped clean
// across the transcript. The largest single move is the shift itself; it is
// also what a lone far-end row (an older page, the loading footer) can never
// inflate past the real one.
export function measuredShift(deltas: Iterable<number>): number {
  let strongest = 0
  for (const delta of deltas) {
    if (Math.abs(delta) > Math.abs(strongest)) strongest = delta
  }
  return strongest
}

export type GrowthAction = { kind: "pin" } | { kind: "shift"; by: number } | { kind: "none" }

export interface GrowthInput {
  atBottom: boolean
  // A navigator tap owns the next position; pinning now would snap it back.
  held: boolean
  // A finger or a fling owns the position; a correction now would fight it.
  dragging: boolean
  grown: number
}

export function contentGrowthAction(input: GrowthInput): GrowthAction {
  if (input.atBottom) return input.held || input.dragging ? { kind: "none" } : { kind: "pin" }
  // Only growth is corrected. Shrinking content (a spoiler folded by the user)
  // pulls the offset down, and clamping that at 0 would land on the newest end
  // — the exact jump this whole mechanism exists to prevent.
  if (input.grown <= 0 || input.dragging) return { kind: "none" }
  return { kind: "shift", by: input.grown }
}
