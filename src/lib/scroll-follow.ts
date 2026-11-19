// The chat transcript is a plain FlatList: the oldest message is at the top and
// the newest at the bottom, so content growth pushes the newest text downward
// and can never move text a reader is holding further up.
//
// An inverted list was tried first and cost four failed fixes: its growth runs
// upward in content coordinates, so every existing row shifts whenever an answer
// streams, and the correction had to guess the amount after the layout settled.
// Per-cell deltas were summed once, a baseline was read after being overwritten
// once, and the native maintainVisibleContentPosition did nothing at all here.
// With no inversion there is nothing to compensate.
export const FOLLOW_BOTTOM_MAX_OFFSET = 24

// Distance from the bottom edge of the content, in pixels.
export function isNearBottom(offsetY: number, viewportHeight: number, contentHeight: number): boolean {
  if (contentHeight <= 0 || viewportHeight <= 0) return true
  return contentHeight - (offsetY + viewportHeight) <= FOLLOW_BOTTOM_MAX_OFFSET
}

// The offset that shows the last pixel of the content. `scrollToEnd` aims at
// the last row's measured frame instead, and a streaming chunk grows that row
// before the frame is re-measured: the list stops a line short and the rest has
// to be dragged. The height in the content-size event is already the real end.
export function endScrollOffset(contentHeight: number, viewportHeight: number): number {
  return Math.max(0, contentHeight - viewportHeight)
}

// Older pages are inserted above the reader, which in a plain list pushes every
// visible row down. This is the case the native helper was built for, and the
// only one it is used for here: appends and streaming growth at the bottom move
// nothing above them, so they need no correction. An index of 0 lets any visible
// child anchor — the loading header or a row.
export const MAINTAIN_VISIBLE_CONTENT_POSITION = { minIndexForVisible: 0 } as const
