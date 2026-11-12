// Which live events deserve an OS notification?
//
// The app used to drop every notification while it was in the foreground —
// including a finished run or a pending question for a session the user was
// not looking at, which is exactly when the shade is the only way to notice.
// Suppress only the event the user is already watching: the session that is
// open on screen while the app is active. Everything else is delivered; the
// system shows it as a banner over the app, and a tapped banner still routes
// to the session (see notifications.onTap).
export function shouldNotify(
  appActive: boolean,
  sessionId: string | undefined,
  viewedSessionId: string | null | undefined,
): boolean {
  if (!appActive) return true
  // Connection drops have no session and already render an in-app banner.
  if (!sessionId) return false
  return sessionId !== viewedSessionId
}
