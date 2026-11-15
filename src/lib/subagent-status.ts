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
  if (child?.time?.idle) return "done"
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
 */
export function collectSubagents(items: ReadonlyArray<{ parts: readonly PartLike[] }>): SubagentRef[] {
  const out: SubagentRef[] = []
  for (const item of items) {
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
      })
    }
  }
  return out
}

/**
 * Call order with the ones still working pulled to the top: a running subagent
 * must never be hidden under a finished one, however long the list grows.
 */
export function orderSubagents(
  refs: readonly SubagentRef[],
  statusOf: (ref: SubagentRef) => SubagentStatus,
): SubagentRef[] {
  const running = refs.filter((ref) => statusOf(ref) === "running")
  const rest = refs.filter((ref) => statusOf(ref) !== "running")
  return [...running, ...rest]
}
