// The chat transcript is an inverted FlatList: offset 0 is the newest message
// (visual bottom) and larger offsets mean the user scrolled up. New content is
// followed only while the user is at the bottom; otherwise their reading
// position would be yanked away by every streaming delta.
export const FOLLOW_BOTTOM_MAX_OFFSET = 24

export function shouldFollowBottom(offsetY: number): boolean {
  return offsetY <= FOLLOW_BOTTOM_MAX_OFFSET
}

// The navigation strip has its own, much looser threshold on purpose: it takes
// 56pt away from the transcript, so showing it for a 30px nudge would make it
// flicker under the thumb. Auto-follow stays tight (above) because it only
// affects where new content lands, never the layout height.
export const NAV_STRIP_MIN_OFFSET = 200

export function shouldShowNavStrip(offsetY: number): boolean {
  return offsetY > NAV_STRIP_MIN_OFFSET
}
