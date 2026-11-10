// Duration shown on a tool row.
//
// A running tool has a start and no end, so it needs the caller's clock: the
// card used to require both timestamps and therefore showed nothing at all
// while a tool ran. A ten-minute command then looked exactly like a frozen app.
// V2 servers also send no state.time at all, which v2-compat.ts now synthesizes.
export function formatToolDuration(start?: number, end?: number, now?: number): string | null {
  if (!start) return null
  const finish = end ?? now
  if (!finish || finish < start) return null
  const ms = finish - start
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  // Sub-minute keeps the existing "12.3s" look; longer runs read better as
  // "2m 05s" than as a four-digit second count.
  if (seconds < 60) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`
}
