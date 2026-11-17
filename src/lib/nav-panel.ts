// The transcript navigator appears while the user scrolls and hides at rest:
// a permanent floating control sits on top of message text on a phone. The
// grace period is generous because the buttons are small and the hand is
// already moving — a panel that vanishes under the thumb is worse than none.
export const NAV_PANEL_IDLE_MS = 3500

// A row counts as visible as soon as any sliver is on screen: the counter must
// follow the message the eye lands on, not wait for a full row.
export const VIEWABILITY = { itemVisiblePercentThreshold: 1 }
