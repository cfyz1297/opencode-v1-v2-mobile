// The chat transcript is an inverted FlatList: offset 0 is the newest message
// (visual bottom) and larger offsets mean the user scrolled up. New content is
// followed only while the user is at the bottom; otherwise their reading
// position would be yanked away by every streaming delta.
export const FOLLOW_BOTTOM_MAX_OFFSET = 24

export function shouldFollowBottom(offsetY: number): boolean {
  return offsetY <= FOLLOW_BOTTOM_MAX_OFFSET
}

export interface NewestCellFrame {
  id: string
  height: number
}

// How far the reading position must move when the newest row changed height.
// Streaming grows exactly that row, and in an inverted list every other row
// shifts by the same amount — without the correction the text the user is
// reading moves under their eyes. A new row counts with its full height
// (everything behind it shifted that far); growth at the far, oldest end (an
// older page or the loading footer) leaves the newest row alone, so 0.
export function anchorShift(prev: NewestCellFrame | undefined, next: NewestCellFrame | undefined): number {
  if (!next) return 0
  if (prev && prev.id === next.id) return Math.max(0, next.height - prev.height)
  return Math.max(0, next.height)
}
