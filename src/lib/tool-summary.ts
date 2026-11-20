// Collapsed-summary data for the activity spoiler.
//
// The desktop client shows what a run actually used while it stays folded —
// "28 Оболочка, Чтение, Веб-поиск и Webfetch · 24s" — so the reader can tell a
// read-only exploration from a build without opening anything. The phone had
// only the step count, which says nothing about what happened.
import type { Part } from "./sdk"

export type ToolKind =
  | "shell"
  | "read"
  | "edit"
  | "search"
  | "webfetch"
  | "websearch"
  | "todo"
  | "tool"

// Server tool names differ between API generations (`bash`/`shell`), and a
// name we do not know must still show up as something.
const KINDS: Record<string, ToolKind> = {
  bash: "shell",
  shell: "shell",
  read: "read",
  write: "edit",
  edit: "edit",
  patch: "edit",
  multiedit: "edit",
  grep: "search",
  glob: "search",
  search: "search",
  list: "search",
  webfetch: "webfetch",
  websearch: "websearch",
  todowrite: "todo",
  todoread: "todo",
}

export function toolKind(name?: string): ToolKind {
  return (name && KINDS[name.toLowerCase()]) || "tool"
}

export interface ToolActivity {
  /** Distinct tool kinds, most used first. */
  kinds: ToolKind[]
  /** How many tool calls the run made. */
  count: number
  /** Sum of the finished calls' durations. */
  totalMs: number
  running: boolean
  failed: boolean
}

// A call is live from its first event until a terminal one closes it. V2 parts
// arrive as "pending" while the tool input streams, so waiting for the literal
// "running" status left the clock frozen from call time to execution.
export function isLiveTool(tool: Part): boolean {
  const state = tool.state
  if (state?.status === "completed" || state?.status === "error") return false
  return typeof state?.time?.start === "number" && state.time.end === undefined
}

export function summarizeToolActivity(tools: Part[], now = Date.now()): ToolActivity {
  const counts = new Map<ToolKind, number>()
  let totalMs = 0
  let running = false
  let failed = false

  for (const tool of tools) {
    const kind = toolKind(tool.tool)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
    const state = tool.state
    if (isLiveTool(tool)) running = true
    if (state?.status === "error") failed = true
    const start = state?.time?.start
    if (typeof start !== "number") continue
    // A live call is counted up to now, so the total moves while the user
    // watches instead of staying at zero until the run ends. A finished call
    // with no end stamp has an unknown duration: counting it to `now` made an
    // old segment's total grow on every render.
    const end = state?.time?.end ?? (isLiveTool(tool) ? now : undefined)
    if (end !== undefined && end >= start) totalMs += end - start
  }

  // Stable order: most used first, ties keep the order they appeared in.
  const kinds = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind]) => kind)

  return { kinds, count: tools.length, totalMs, running, failed }
}
