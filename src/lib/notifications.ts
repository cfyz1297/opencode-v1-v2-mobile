import * as Notifications from "expo-notifications"
import * as Device from "expo-device"
import { NativeModules, Platform, AppState } from "react-native"
import { log } from "./logbuffer"

// ---------------------------------------------------------------------------
// Categories — every notification belongs to exactly one
// ---------------------------------------------------------------------------

export const categories = ["permissions", "questions", "completed", "errors", "connection"] as const
export type Category = (typeof categories)[number]

// Per-category metadata used by both the notification module and the settings UI.
// label/description are i18next keys (not display strings) — this module loads
// before i18next is guaranteed to be ready, so callers (e.g. settings.tsx) resolve
// them with t() at render time instead of reading literal text here.
export const categoryMeta: Record<Category, { labelKey: string; descriptionKey: string; icon: string }> = {
  permissions: {
    labelKey: "notifications.categories.permissions.label",
    descriptionKey: "notifications.categories.permissions.description",
    icon: "shield-checkmark",
  },
  questions: {
    labelKey: "notifications.categories.questions.label",
    descriptionKey: "notifications.categories.questions.description",
    icon: "help-circle",
  },
  completed: {
    labelKey: "notifications.categories.completed.label",
    descriptionKey: "notifications.categories.completed.description",
    icon: "checkmark-circle",
  },
  errors: {
    labelKey: "notifications.categories.errors.label",
    descriptionKey: "notifications.categories.errors.description",
    icon: "alert-circle",
  },
  connection: {
    labelKey: "notifications.categories.connection.label",
    descriptionKey: "notifications.categories.connection.description",
    icon: "wifi",
  },
}

// Default state — permissions and questions on (they block work), the rest off
export const defaultPreferences: Record<Category, boolean> = {
  permissions: true,
  questions: true,
  completed: false,
  errors: true,
  connection: true,
}

// ---------------------------------------------------------------------------
// Notification payload — what callers pass in
// ---------------------------------------------------------------------------

export interface Payload {
  category: Category
  title: string
  body: string
  sessionId: string
  dedupeKey?: string
  dedupeCooldownMs?: number
}

// Data embedded in the notification for tap handling
interface NotificationData {
  category: Category
  sessionId: string
}

// ---------------------------------------------------------------------------
// Preferences accessor — injected to avoid circular imports with the store
// ---------------------------------------------------------------------------

type PreferencesAccessor = () => Record<Category, boolean>

let preferences: PreferencesAccessor = () => defaultPreferences
const dedupeSentAt = new Map<string, number>()

export function configure(accessor: PreferencesAccessor) {
  preferences = accessor
}

// ---------------------------------------------------------------------------
// Setup & permissions
// ---------------------------------------------------------------------------

// The app's own channel, not expo's fallback: the fallback is created lazily
// with its own name/importance, so the user could not tune "Session prompts"
// separately in system settings and the high-importance behaviour would be
// whatever expo picked. A channel-aware trigger is also the only way to name a
// channel: `content.channelId` is ignored on Android.
export const CHANNEL_ID = "prompts"

interface NotifyBridge {
  notify: (category: string, title: string, body: string, sessionId: string, channelId: string) => Promise<boolean>
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

export async function setup(): Promise<boolean> {
  if (!Device.isDevice) return false

  try {
    const { status: existing } = await Notifications.getPermissionsAsync()
    if (existing === "granted") {
      await ensureChannel()
      return true
    }

    const { status } = await Notifications.requestPermissionsAsync()
    if (status !== "granted") return false

    await ensureChannel()
    return true
  } catch (error) {
    log.warn("notifications", "permission request failed:", error)
    return false
  }
}

export async function granted(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync()
    return status === "granted"
  } catch (error) {
    // Must not reject: callers are fire-and-forget event handlers, and an
    // unhandled rejection there is invisible on device.
    log.warn("notifications", "permission check failed:", error)
    return false
  }
}

async function ensureChannel() {
  if (Platform.OS !== "android") return
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Session Prompts & Updates",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: "default",
  })
}

// A channel-aware trigger is expo's "deliver now, on this channel" form. With
// `trigger: null` the native side silently falls back to expo's own channel.
function immediateTrigger() {
  return Platform.OS === "android" ? { channelId: CHANNEL_ID } : null
}

// ---------------------------------------------------------------------------
// Send — single entry point, decides whether to fire
// ---------------------------------------------------------------------------

export interface SendOptions {
  /**
   * The caller already knows the app is in the background (the background
   * watch only runs there), so the AppState gate is skipped. Without this a
   * wrong/racy AppState reading silently swallows every background alert.
   */
  force?: boolean
}

/**
 * A payload that arrived while the app was still technically in the foreground
 * is held for a moment instead of being dropped: when you send a prompt and
 * minimize, the first status events can land a fraction of a second before
 * Android reports the transition. The window is deliberately short — a longer
 * one turns into "a notification appears right after opening the app", which is
 * exactly the noise the user asked to avoid.
 */
export const HOLD_TTL_MS = 3_000
let held: Array<{ payload: Payload; at: number }> = []

export type AttemptOutcome = "posted" | "held" | "app-active" | "disabled" | "no-permission" | "deduped" | "error"

const attempts: Array<{ at: number; category: Category; outcome: AttemptOutcome; detail?: string }> = []

function record(category: Category, outcome: AttemptOutcome, detail?: string) {
  attempts.push({ at: Date.now(), category, outcome, detail })
  if (attempts.length > 12) attempts.shift()
  // The diagnostics block in Settings reads these lines; without them a missing
  // notification is indistinguishable from a notification that was never
  // generated — the reason the first three attempts could not be diagnosed.
  log.info("notifications", `${category}: ${outcome}${detail ? ` — ${detail}` : ""}`)
}

export async function send(payload: Payload, options: SendOptions = {}) {
  if (!preferences()[payload.category]) return record(payload.category, "disabled")

  if (!options.force && AppState.currentState === "active") {
    held.push({ payload, at: Date.now() })
    if (held.length > 5) held.shift()
    return record(payload.category, "held")
  }

  if (!(await granted())) return record(payload.category, "no-permission")

  if (payload.dedupeKey) {
    const now = Date.now()
    const lastSent = dedupeSentAt.get(payload.dedupeKey) || 0
    const cooldown = payload.dedupeCooldownMs ?? 30_000
    if (now - lastSent < cooldown) return record(payload.category, "deduped")
    dedupeSentAt.set(payload.dedupeKey, now)
    // BUG-029: prune stale dedupe entries so the map doesn't grow unbounded
    // on long-lived sessions.
    for (const [key, sentAt] of dedupeSentAt.entries()) {
      if (now - sentAt > cooldown * 4) dedupeSentAt.delete(key)
    }
  }

  const result = await deliver(payload.title, payload.body, {
    category: payload.category,
    sessionId: payload.sessionId,
  })
  record(payload.category, result.ok ? "posted" : "error", result.error)
}

/**
 * The app just left the foreground. Post whatever it was holding back — the
 * user is no longer looking at the transcript.
 */
export function flushHeld() {
  const now = Date.now()
  const due = held.filter((entry) => now - entry.at <= HOLD_TTL_MS).map((entry) => entry.payload)
  held = []
  for (const payload of due) void send(payload, { force: true })
}

/**
 * The app is on screen again. Anything still held was generated while the app
 * was coming back (the event stream replays what happened while it was away) —
 * the user is looking at the transcript, so it must not surface later.
 */
export function dropHeld() {
  held = []
}

/**
 * Post one notification through the same path the app uses for real events, and
 * report what happened. Exists because a notification either appears or does
 * not — there is no error the user can see, and the reason (permission denied,
 * scheduling threw) is invisible without adb.
 */
export async function sendTest(title: string, body: string): Promise<{ ok: boolean; reason?: string }> {
  const { status } = await Notifications.getPermissionsAsync()
  if (status !== "granted") return { ok: false, reason: status }
  // Same path as a real alert, so the test also shows its icon.
  const result = await deliver(title, body, { category: "completed", sessionId: "test" })
  return result.ok ? { ok: true } : { ok: false, reason: result.error }
}

async function deliver(title: string, body: string, data: NotificationData): Promise<{ ok: boolean; error?: string }> {
  try {
    // A missing channel makes Android drop the notification silently.
    await ensureChannel()

    // One monochrome icon per category needs the native side: expo-notifications
    // has a single small icon for the whole app (and it was a full-colour PNG,
    // which Android paints as a white square).
    const bridge = Platform.OS === "android" ? (NativeModules.Notify as NotifyBridge | undefined) : undefined
    if (bridge) {
      // Rejects with the native reason, which the catch below logs.
      await bridge.notify(data.category, title, body, data.sessionId ?? "", CHANNEL_ID)
      return { ok: true }
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data as unknown as Record<string, unknown>,
        sound: "default",
      },
      trigger: immediateTrigger(),
    })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Never let a failed notification take down the event handler that called
    // it; the log line lands in the diagnostics report.
    log.error("notifications", "could not show a notification:", message)
    return { ok: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// Tap handler — returns cleanup function
// ---------------------------------------------------------------------------

export function onTap(handler: (data: NotificationData) => void) {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const raw = response.notification.request.content.data
    const data = raw as unknown as NotificationData | undefined
    if (!data) return
    if (data.sessionId || data.category === "connection") {
      handler(data)
    }
  })
  return () => subscription.remove()
}

/**
 * Cold-start tap: when the app is launched from a push notification while the
 * JS process is not running, `onTap`'s listener is mounted too late — the
 * response has already been delivered. Read it here so a cold-start tap still
 * routes to the right session (BUG-005).
 */
export async function getInitialResponse(): Promise<NotificationData | null> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync()
    const raw = response?.notification.request.content.data
    const data = raw as unknown as NotificationData | undefined
    if (!data) return null
    if (data.sessionId || data.category === "connection") return data
    return null
  } catch {
    return null
  }
}
