// Android freezes a cached app process seconds after it leaves the foreground.
// That kills both the SSE socket and the JS timers the background watch needs,
// so "task completed" / "input needed" never reached the phone once the screen
// was off. While an agent run is active a foreground service keeps the process
// alive; this module is its JS side (native code: plugins/native/keepalive).
import { NativeModules } from "react-native"
import i18n from "./i18n/config"
import { log } from "./logbuffer"

interface KeepAliveBridge {
  start: (title: string, body: string) => void
  stop: () => void
}

// Literal fallbacks: the service must never fail to start because a translation
// key is missing or i18next is not ready — the cost is losing every background
// notification, silently.
const FALLBACK = {
  title: "Session running",
  body: "Notifications will arrive even when the app is in the background",
}

let active = false

function label(key: string, fallback: string): string {
  try {
    const value = i18n.t(key)
    return typeof value === "string" && value.length > 0 ? value : fallback
  } catch {
    return fallback
  }
}

/**
 * Idempotent: `session.status` fires many times per run, and every call would
 * re-post the ongoing notification. A missing native module (Expo Go, tests)
 * degrades to "no keep-alive" — notifications still work while the app is alive.
 */
export function setKeepAlive(running: boolean) {
  if (running === active) return
  const bridge = NativeModules.KeepAlive as KeepAliveBridge | undefined
  if (!bridge) {
    log.warn("keepalive", "native module missing — background notifications cannot be relied on")
    return
  }
  try {
    if (running) {
      bridge.start(label("notifications.keepAlive.title", FALLBACK.title), label("notifications.keepAlive.body", FALLBACK.body))
    } else {
      bridge.stop()
    }
    active = running
    log.info("keepalive", running ? "started" : "stopped")
  } catch (error) {
    // Never let the service break the event stream.
    active = false
    log.error("keepalive", "could not", running ? "start" : "stop", "the service:", error instanceof Error ? error.message : error)
  }
}
