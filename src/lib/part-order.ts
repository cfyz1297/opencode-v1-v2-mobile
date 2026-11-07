import type { Part } from "./sdk"

/**
 * Should a live part update replace the part already in the store?
 *
 * V2 sends the whole accumulated text with every delta, so a text part is
 * append-only while a run streams. After the app returns from the background
 * the socket backlog can arrive *after* the transcript refetch that already
 * holds the complete answer — applying that older, shorter snapshot made the
 * bubble visibly re-type an answer that was on screen. An empty value is the
 * `session.text.started` reset (server replay/rollback) and must always land.
 */
export function shouldApplyPartUpdate(existing: Part | undefined, incoming: Part): boolean {
  if (!existing) return true
  if (existing.type !== incoming.type) return true
  if (incoming.type !== "text" && incoming.type !== "reasoning") return true
  const next = incoming.text ?? ""
  if (next.length === 0) return true
  return next.length >= (existing.text ?? "").length
}
