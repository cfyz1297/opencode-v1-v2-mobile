// Android freezes a cached app process seconds after it leaves the foreground,
// and — separately — React Native stops JS timers when the host is paused
// (JavaTimerManager drops the frame callback while isPaused && no headless
// task). Both had to be dealt with:
//
//  * the foreground service keeps the process alive;
//  * the headless task it starts keeps `hasActiveTasks()` true, which is what
//    allows setInterval/fetch to run in the background at all.
//
// Native code: plugins/native/keepalive.
import { AppRegistry, NativeModules } from "react-native"
import i18n from "./i18n/config"
import { log } from "./logbuffer"

interface KeepAliveBridge {
  start: (title: string, body: string) => void
  stop: () => void
}

const TASK_KEY = "KeepAliveBackground"

// Literal fallbacks: the service must never fail to start because a translation
// key is missing or i18next is not ready — the cost is losing every background
// notification, silently.
const FALLBACK = {
  title: "Session running",
  body: "Notifications will arrive even when the app is in the background",
}

let active = false
let taskRegistered = false
// One resolver per started task: the promises must stay pending for the whole
// run and settle when it ends, otherwise RN keeps treating the app as having
// active work (and never lets the timers pause again).
const taskResolvers: Array<() => void> = []

function registerTask() {
  if (taskRegistered) return
  taskRegistered = true
  try {
    AppRegistry.registerHeadlessTask(TASK_KEY, () => () => {
      log.info("keepalive", "headless task running — background timers enabled")
      return new Promise<void>((resolve) => {
        taskResolvers.push(() => {
          log.info("keepalive", "headless task settled")
          resolve()
        })
      })
    })
  } catch (error) {
    log.error("keepalive", "could not register the headless task:", error instanceof Error ? error.message : error)
  }
}

function label(key: string, fallback: string): string {
  try {
    const value = i18n.t(key)
    return typeof value === "string" && value.length > 0 ? value : fallback
  } catch {
    return fallback
  }
}

function stopTasks() {
  const resolvers = taskResolvers.splice(0)
  for (const resolve of resolvers) resolve()
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
      // Must exist before the service asks for it.
      registerTask()
      bridge.start(label("notifications.keepAlive.title", FALLBACK.title), label("notifications.keepAlive.body", FALLBACK.body))
    } else {
      bridge.stop()
      stopTasks()
    }
    active = running
    log.info("keepalive", running ? "started" : "stopped")
  } catch (error) {
    // Never let the service break the event stream.
    active = false
    stopTasks()
    log.error("keepalive", "could not", running ? "start" : "stop", "the service:", error instanceof Error ? error.message : error)
  }
}
