// Chat message visibility while a revert is pending — pure logic extracted
// verbatim from app/session/[id].tsx messageData (0.2.10 audit) so the
// lexicographic revert-point comparison is unit-testable with plain
// `node --test` (repo pattern: see message-merge.ts).
//
// While a revert is pending, the reverted message and everything after it
// still exist server-side (cleanup only runs on the next prompt/unrevert)
// — hide them client-side so editing feels immediate. Message IDs are
// lexicographically sortable, same comparison the TUI uses. Optimistic
// "temp-" IDs (assigned client-side before the server responds, see
// sendMessage) aren't part of that sort order — always keep them so a
// message sent concurrently with a revert isn't hidden.
import type { Message, Part } from "./sdk"

export function isHiddenByRevert(messageID: string, revertMessageID: string | null | undefined): boolean {
  if (!revertMessageID) return false
  if (messageID.startsWith("temp-")) return false
  return messageID >= revertMessageID
}

export interface MessageDataItem {
  message: Message
  parts: Part[]
}

// Shared empty array for messages that have no parts yet, so the cache below
// can recognise them as unchanged instead of comparing a fresh [] every delta.
const EMPTY_PARTS: Part[] = []

/**
 * Assemble the transcript list data for the chat screen: filter messages
 * hidden by the pending revert and attach each message's parts, newest first.
 * The chat screen reverses the result once so the newest message renders at the
 * bottom of a plain list.
 *
 * BUG-032: streaming deltas replace the `parts` record on every token. When a
 * cache is supplied, unchanged messages keep the exact same item object (and
 * parts array) so MessageBubble's memo comparator can skip them; only the
 * message whose parts actually changed gets a new item.
 */
export function buildMessageData(
  messages: Message[],
  parts: Record<string, Part[]>,
  revertMessageID: string | null | undefined,
  cache?: Map<string, MessageDataItem>,
): MessageDataItem[] {
  const list = (messages || []).filter((msg) => !isHiddenByRevert(msg.id, revertMessageID))

  return list
    .map((msg) => {
      const nextParts = (parts && parts[msg.id]) || EMPTY_PARTS
      if (!cache) return { message: msg, parts: nextParts }

      const cached = cache.get(msg.id)
      if (cached && cached.message === msg && cached.parts === nextParts) return cached

      const item = { message: msg, parts: nextParts }
      cache.set(msg.id, item)
      return item
    })
    .reverse()
}
