import * as Notifications from "expo-notifications"
import * as Device from "expo-device"
import { Platform, AppState } from "react-native"
import { shouldNotify } from "./notify-policy"

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
// The session whose chat is on screen right now. Notifications for it are
// suppressed while the app is active (see notify-policy.ts); the session
// screen sets it on focus and clears it on blur.
let viewedSession: string | null = null
const dedupeSentAt = new Map<string, number>()

export function configure(accessor: PreferencesAccessor) {
  preferences = accessor
}

export function setViewedSession(sessionID: string | null) {
  viewedSession = sessionID
}

// ---------------------------------------------------------------------------
// Setup & permissions
// ---------------------------------------------------------------------------

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

  const { status: existing } = await Notifications.getPermissionsAsync()
  if (existing === "granted") {
    await ensureChannel()
    return true
  }

  const { status } = await Notifications.requestPermissionsAsync()
  if (status !== "granted") return false

  await ensureChannel()
  return true
}

export async function granted(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync()
  return status === "granted"
}

async function ensureChannel() {
  if (Platform.OS !== "android") return
  await Notifications.setNotificationChannelAsync("prompts", {
    name: "Session Prompts & Updates",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: "default",
  })
}

// ---------------------------------------------------------------------------
// Send — single entry point, decides whether to fire
// ---------------------------------------------------------------------------

export async function send(payload: Payload) {
  const prefs = preferences()
  if (!prefs[payload.category]) return
  // Foreground notifications are delivered too: "the app is open" is not the
  // same as "the user is reading this session". Only that one chat is quiet.
  if (!shouldNotify(AppState.currentState === "active", payload.sessionId, viewedSession)) return
  if (!(await granted())) return

  // The channel must exist before the notification is posted or Android drops
  // it silently; setup() creates it on connect, but a notification can fire
  // before that finished.
  await ensureChannel()

  if (payload.dedupeKey) {
    const now = Date.now()
    const lastSent = dedupeSentAt.get(payload.dedupeKey) || 0
    const cooldown = payload.dedupeCooldownMs ?? 30_000
    if (now - lastSent < cooldown) return
    dedupeSentAt.set(payload.dedupeKey, now)
    // BUG-029: prune stale dedupe entries so the map doesn't grow unbounded
    // on long-lived sessions.
    for (const [key, sentAt] of dedupeSentAt.entries()) {
      if (now - sentAt > cooldown * 4) dedupeSentAt.delete(key)
    }
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: payload.title,
      body: payload.body,
      data: {
        category: payload.category,
        sessionId: payload.sessionId,
      } satisfies NotificationData as Record<string, unknown>,
      sound: "default",
      ...(Platform.OS === "android" ? { channelId: "prompts" } : {}),
    },
    trigger: null,
  })
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
