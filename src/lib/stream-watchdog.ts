// Decide when a live-looking event stream has actually died.
//
// The V2 server writes a `: heartbeat` comment every ~15s (measured), which
// keeps any read on the socket from blocking forever on a healthy connection.
// A mobile socket can still die without a FIN (Wi-Fi drop, Doze, NAT timeout):
// `connected` stays true, reader.read() never returns, and nothing schedules
// a reconnect - the UI then shows the optimistic "Working..." spinner until
// the session is reopened. Treat a long silence *during a run* as a dead
// stream; silence while idle is normal and must never trigger a reconnect.

/** 2x the server heartbeat interval - one missed beat plus jitter. */
export const STREAM_STALL_MS = 30_000

export interface StreamStallInput {
  /** A run is in flight (SSE said busy, or the send tap set the optimistic flag). */
  activeRun: boolean
  /** Last time any byte arrived on the stream (events and heartbeat comments both count). */
  lastActivityAt: number
  now: number
  stallMs?: number
}

export function isStreamStalled({
  activeRun,
  lastActivityAt,
  now,
  stallMs = STREAM_STALL_MS,
}: StreamStallInput): boolean {
  if (!activeRun) return false
  return now - lastActivityAt >= stallMs
}

/**
 * How long the app must have been in the background before the event stream is
 * discarded on return. Android suspends JS timers and can drop a socket without
 * a FIN: the reader then never resolves, and the stall watchdog only watches
 * runs — so an app resumed into a dead stream stays silent until the next
 * prompt waits out the stall window. One reconnect is cheaper than that.
 */
export const RESUME_RECONNECT_AFTER_MS = 15_000

export function shouldReconnectOnResume(backgroundedForMs: number): boolean {
  return backgroundedForMs >= RESUME_RECONNECT_AFTER_MS
}
