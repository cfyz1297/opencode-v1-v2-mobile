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
