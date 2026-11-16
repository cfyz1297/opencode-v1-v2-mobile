// The chat transcript is an inverted FlatList: offset 0 is the newest message
// (visual bottom) and larger offsets mean the user scrolled up. New content is
// followed only while the user is at the bottom; otherwise their reading
// position would be yanked away by every streaming delta.
export const FOLLOW_BOTTOM_MAX_OFFSET = 24

export function shouldFollowBottom(offsetY: number): boolean {
  return offsetY <= FOLLOW_BOTTOM_MAX_OFFSET
}
