import { useEffect, useState } from "react"

/**
 * A one-second clock for anything that is still running. Without it a frozen
 * duration is indistinguishable from a stalled agent. Returns `undefined`
 * while inactive or before the first tick, so callers show no clock yet.
 *
 * `anchor` is the start timestamp: changing it restarts the clock, which is
 * how one run's elapsed time cannot leak into the next.
 */
export function useTickingNow(active: boolean, anchor: number | undefined): number | undefined {
  const [now, setNow] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (!active || !anchor) {
      setNow(undefined)
      return
    }
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active, anchor])
  return now
}
