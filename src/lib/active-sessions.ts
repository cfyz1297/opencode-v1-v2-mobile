// Which server-side runs a restarted app should adopt.
//
// A crash wipes every in-memory busy flag, but the server keeps the run — and
// the question it is blocked on — alive. The active list is the only source
// that survives a restart, so the sessions missing a local status are marked
// busy; the screen then polls their prompts and the run clock has a start.
// Sessions the app already knows (busy or idle) are never overwritten.
export function sessionsWithoutStatus(
  active: Iterable<string>,
  statuses: Record<string, unknown>,
): string[] {
  const seen = new Set<string>()
  const missing: string[] = []
  for (const id of active) {
    if (statuses[id] || seen.has(id)) continue
    seen.add(id)
    missing.push(id)
  }
  return missing
}
