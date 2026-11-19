// The chat transcript is an inverted FlatList: offset 0 is the newest message
// (visual bottom) and larger offsets mean the user scrolled up.
//
// Keeping a reader's place while an answer streams is delegated to the native
// `maintainVisibleContentPosition` helper rather than recomputed here. Four
// hand-rolled versions of that correction shipped bugs: a latched follow flag
// hid the whole answer, a baseline written before its delta shifted by zero,
// summing every cell multiplied the shift, and the content-size event arrives
// before the cells' own layouts so the delta was always one frame late. The
// native helper runs after mount, measures the anchor view itself, and needs no
// state of ours.
export const FOLLOW_BOTTOM_MAX_OFFSET = 24

export function shouldFollowBottom(offsetY: number): boolean {
  return offsetY <= FOLLOW_BOTTOM_MAX_OFFSET
}

// The config for that helper on an inverted list.
//
// minIndexForVisible 0 anchors the newest row itself: while it grows, its top
// stays put, so the list does not need to move — the reader at the bottom keeps
// seeing the newest text. Any higher index would anchor the previous message
// instead, and every growing answer would scroll itself out of view.
//
// autoscrollToTopThreshold makes a jump back to offset 0 happen only while the
// user is already near the newest end. Without it the list would stay pinned to
// the previous message and a new one would sit below the bottom edge.
export const MAINTAIN_VISIBLE_CONTENT_POSITION = {
  minIndexForVisible: 0,
  autoscrollToTopThreshold: FOLLOW_BOTTOM_MAX_OFFSET,
} as const
