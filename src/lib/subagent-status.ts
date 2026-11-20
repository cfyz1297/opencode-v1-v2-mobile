// Status of a delegated subagent session, shown on the row that launched it.
//
// The `subagent` tool returns as soon as the child is dispatched — its own
// state goes to "completed" while the child keeps working in the background
// (the parent gets a `subagent` message when the child goes idle). So the tool
// part cannot answer "is it still running?"; the child session can:
//
//   failed   an error event for that session (sessionErrors in stores/events)
//   running  the live session.status is busy/retry
//   done     the child has an idle timestamp (covers children that finished
//            before the app connected, which have no busy -> idle transition)
//   idle     created, never started
//
// Same precedence as upstream's deriveChildStatus (dzianisv/opencode-mobile
// eff8c46), kept independent of React so it is testable without a device.
import type { Session } from "./sdk"

export type SubagentStatus = "running" | "done" | "failed" | "idle"

export interface LiveStatus {
  type?: string
}

export function deriveSubagentStatus(
  child: Pick<Session, "time"> | undefined,
  live: LiveStatus | undefined,
  error: string | undefined,
): SubagentStatus {
  if (error) return "failed"
  if (live?.type === "busy" || live?.type === "retry") return "running"
  // No live status (a cold open, or a child that never emitted an event to this
  // client): the run stamps are the next best evidence. A busy stamp newer than
  // the idle one means the child is still working — without this a running
  // subagent read as Idle until it happened to emit the next event.
  const busy = child?.time?.busy
  const idle = child?.time?.idle
  if (busy !== undefined && (idle === undefined || busy > idle)) return "running"
  if (idle) return "done"
  return "idle"
}

export function summarizeSubagents(
  children: readonly Pick<Session, "id" | "time">[],
  live: Record<string, LiveStatus | undefined>,
  errors: Record<string, string | undefined>,
): Record<SubagentStatus, number> {
  const out: Record<SubagentStatus, number> = { running: 0, done: 0, failed: 0, idle: 0 }
  for (const child of children) out[deriveSubagentStatus(child, live[child.id], errors[child.id])]++
  return out
}

/** Label key for the status pill; the value lives in chat.subagents.* */
export function subagentStatusKey(status: SubagentStatus): `chat.subagents.${SubagentStatus}` {
  return `chat.subagents.${status}`
}

/** A delegated subagent as the transcript knows it: no session data yet. */
export interface SubagentRef {
  sessionID: string
  parentID?: string
  agent?: string
  title?: string
  /**
   * Which user turn delegated it. One turn can spawn several subagents (a
   * fan-out), and the next turn starts a new wave — that is the boundary the
   * "current" button uses.
   */
  wave: number
}

type PartLike = {
  type: string
  sessionID?: string
  state?: {
    input?: unknown
    metadata?: Record<string, unknown>
  }
}

function inputString(input: unknown, key: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/**
 * Every delegated subagent in the transcript, in the order it was called. The
 * child session id lives in the tool part's metadata (see v2-compat), so a
 * transcript restored from the server lists exactly the subagents its cards do.
 *
 * `items` must be chronological. Each user message opens a new wave, so
 * subagents delegated by one prompt group together and a later prompt starts
 * the next batch.
 */
export function collectSubagents(
  items: ReadonlyArray<{ message?: { role?: string }; parts: readonly PartLike[] }>,
): SubagentRef[] {
  const out: SubagentRef[] = []
  let wave = 0
  for (const item of items) {
    if (item.message?.role === "user") wave++
    for (const part of item.parts ?? []) {
      if (part.type !== "tool") continue
      const tool = (part as { tool?: string }).tool
      if (tool !== "subagent" && tool !== "task") continue
      const child = part.state?.metadata?.sessionID
      if (typeof child !== "string" || child.length === 0) continue
      if (out.some((ref) => ref.sessionID === child)) continue
      out.push({
        sessionID: child,
        parentID: part.sessionID,
        agent: inputString(part.state?.input, "agent"),
        title: inputString(part.state?.input, "description") ?? inputString(part.state?.input, "prompt"),
        wave,
      })
    }
  }
  return out
}

/**
 * What the "current" button opens: the latest wave (running and just finished
 * alike) plus anything still working from an earlier wave — a long-running
 * subagent must never disappear from the counter when a new batch starts.
 */
export function visibleSubagents(
  refs: readonly SubagentRef[],
  statusOf: (ref: SubagentRef) => SubagentStatus,
): SubagentRef[] {
  if (refs.length === 0) return []
  const latest = refs.reduce((max, ref) => Math.max(max, ref.wave), refs[0].wave)
  return refs.filter((ref) => ref.wave === latest || statusOf(ref) === "running")
}

/** The stamp a subagent row shows as "N ago" — also the list's order key. */
export function subagentSince(child: Pick<Session, "time"> | undefined): number | undefined {
  return child?.time?.updated ?? child?.time?.created
}

/**
 * Call order with the ones still working pulled to the top, and finished rows
 * newest first: the list answers "what is happening now" and "what happened
 * last", so a fresh run must not sit under an older one. `timeOf` returns the
 * same stamp the row shows as "N ago"; rows without session data keep call
 * order.
 */
export function orderSubagents(
  refs: readonly SubagentRef[],
  statusOf: (ref: SubagentRef) => SubagentStatus,
  timeOf?: (ref: SubagentRef) => number | undefined,
): SubagentRef[] {
  return refs
    .map((ref, index) => ({
      ref,
      index,
      running: statusOf(ref) === "running",
      time: timeOf?.(ref) ?? Number.NEGATIVE_INFINITY,
    }))
    .sort((a, b) => {
      if (a.running !== b.running) return a.running ? -1 : 1
      return a.time === b.time ? a.index - b.index : b.time - a.time
    })
    .map((entry) => entry.ref)
}
