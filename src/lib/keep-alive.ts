// Android freezes a cached app process seconds after it leaves the foreground.
// That kills the SSE socket the notification module generates from, so
// "task completed" / "input needed" never reached the phone once the screen was
// off. While an agent run is active a foreground service keeps the process
// alive; this module is its JS side (native code: plugins/native/keepalive).
import { NativeModules } from "react-native"

interface KeepAliveBridge {
  start: (title: string, body: string) => void
  stop: () => void
}

let active = false

/**
 * Idempotent: `session.status` fires many times per run, and every call would
 * re-post the ongoing notification. A missing native module (Expo Go, ready
 * tests) degrades to "no keep-alive" — notifications still work while the app
 * is alive.
 */
export function setKeepAlive(running: boolean, title: string, body: string) {
  if (running === active) return
  const bridge = NativeModules.KeepAlive as KeepAliveBridge | undefined
  if (!bridge) return
  try {
    if (running) bridge.start(title, body)
    else bridge.stop()
    active = running
  } catch {
    // Never let the service break the event stream.
    active = false
  }
}
