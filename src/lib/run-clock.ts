// When the current run started, so the status bar can show a clock that
// actually moves. A busy event repeats on every status change of the same run
// and a retry belongs to that run, so only idle clears the start.
export function nextRunStart(
  previous: number | undefined,
  statusType: string,
  now: number,
): number | undefined {
  if (statusType === "idle") return undefined
  return previous ?? now
}

/**
 * The clock must count this run, not the previous one. A new run is marked by
 * a user message newer than the recorded start — the only durable boundary
 * when the socket was down for the whole transition (run 1 ended, run 2 began,
 * and the server reports the session busy again). Same run: keep the start.
 *
 * A follow-up prompt inside one run also re-anchors; that under-reports
 * slightly instead of inheriting a previous run's total.
 */
export function retimeRunStart(
  started: number | undefined,
  newestUserAt: number | undefined,
): number | undefined {
  if (newestUserAt === undefined) return started
  return started === undefined || newestUserAt > started ? newestUserAt : started
}

/** Created time of the newest user message, the boundary between two runs. */
export function newestUserMessageAt(
  messages: readonly { role: string; time?: { created?: number } }[],
): number | undefined {
  let newest: number | undefined
  for (const message of messages) {
    if (message.role !== "user") continue
    const created = message.time?.created
    if (typeof created === "number" && (newest === undefined || created > newest)) newest = created
  }
  return newest
}
