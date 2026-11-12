import { create } from "zustand"
import { AppState } from "react-native"
import { useConnections } from "./connections"
import { useSessions, abortedSessions } from "./sessions"
import { send as notify } from "../lib/notifications"
import { PERMISSION_NOTIFICATION_KEY, QUESTION_NOTIFICATION_KEY, sanitizeBody } from "../lib/notify-format"
import i18n from "../lib/i18n/config"
import { statusFromPart } from "../lib/status-labels"
import { isAuthError } from "../lib/api-error"
import { isSessionActuallyIdle } from "../lib/session-status-reconcile"
import { isStreamStalled, shouldReconnectOnResume } from "../lib/stream-watchdog"
import { runsNeedingResync } from "../lib/run-watchdog"
import { reconcilePendingQuestions } from "../lib/pending-questions"
import { recordAnswered, type AnsweredQuestion } from "../lib/answered-questions"
import { setKeepAlive } from "../lib/keep-alive"
import { log } from "../lib/logbuffer"
import type { QuestionRequest } from "../lib/v2-compat"
import type { Client, Part, Session, Message } from "../lib/sdk"

// Session status from the server
type SessionStatus = { type: "idle" } | { type: "busy" } | { type: "retry"; attempt: number; message: string }

interface EventsState {
  connected: boolean
  // Set when the last connection attempt failed with 401/403 — the server
  // rejected our credentials, not a transient network issue. The reconnect
  // loop stops retrying in this case (see connect()) since hammering a
  // fixed-credential auth failure forever just spams Sentry/battery with no
  // path to recovery (issue #76). Cleared on the next connect() attempt,
  // e.g. after the user fixes their credentials on the connection edit screen.
  authError: boolean
  reconnectAttempts: number
  lastDisconnectAt: number | null
  sessionStatus: Record<string, SessionStatus>
  statusText: Record<string, string>
  // Permissions & questions (pending per session)
  permissions: Record<
    string,
    Array<{
      id: string
      sessionID: string
      permission: string
      patterns: string[]
      metadata: Record<string, unknown>
      tool?: { messageID: string; callID: string }
    }>
  >
  questions: Record<
    string,
    Array<{
      id: string
      sessionID: string
      questions: Array<{
        question: string
        header: string
        options: Array<{ label: string; description: string }>
        multiple?: boolean
        custom?: boolean
      }>
      tool?: { messageID: string; callID: string }
    }>
  >
  // Questions already answered, kept so the card can stay in the transcript
  // after the server drops the request (see lib/answered-questions.ts).
  answeredQuestions: Record<string, Array<AnsweredQuestion<QuestionRequest>>>
  recordQuestionAnswer: (sessionID: string, request: QuestionRequest, answers: string[][]) => void

  connect: () => void
  disconnect: () => void
  /** Replace the suspension-prone stream after the app returns from background. */
  resumeFromBackground: (backgroundedForMs: number) => void
}

let controller: AbortController | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
// Set by resumeFromBackground: the next connect() is a recovery, so its first
// byte must re-read the transcript instead of waiting for a run to go quiet.
let forceResyncOnConnect = false

// Sessions that emitted session.error since they last went busy. SessionStatus
// has no error variant — an errored session still ends with a busy -> idle
// transition — so without this mark an errored run would count as a success
// toward the once-ever store review prompt.
const erroredSessions = new Set<string>()

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000] as const
const STABLE_CONNECTION_MS = 10_000
const PROLONGED_DISCONNECT_MS = 30_000
// How often the watchdog compares the clock against the last stream byte.
const STALL_CHECK_MS = 5_000

// Last chunk received on the event stream, heartbeat comments included. A
// healthy V2 connection writes something (usually `: heartbeat`) every ~15s,
// so a longer silence during a run means the socket is dead, not quiet.
let lastStreamActivityAt = 0

// Per-run event clocks. A healthy socket can still deliver zero events for a
// run (see run-watchdog.ts), so each session is tracked separately and gets
// its own transcript resync — otherwise "Working..." and an empty answer
// bubble stay on screen until the session is reopened.
const sessionActivityAt = new Map<string, number>()
const sessionResyncedAt = new Map<string, number>()

/** Record that this session produced a live event, so its run is not silent. */
function markSessionActivity(sessionID: string | undefined) {
  if (!sessionID) return
  sessionActivityAt.set(sessionID, Date.now())
  sessionResyncedAt.delete(sessionID)
}

/** Sessions the UI believes are running: SSE said non-idle, or the send tap
 * set the optimistic flag and no status event has arrived since. */
function activeRunSessionIDs(): string[] {
  const ids = new Set<string>()
  for (const [sessionID, status] of Object.entries(useEvents.getState().sessionStatus)) {
    if (status.type !== "idle") ids.add(sessionID)
  }
  for (const [sessionID, sending] of Object.entries(useSessions.getState().sending)) {
    if (sending) ids.add(sessionID)
  }
  return [...ids]
}

// Keep the process alive (and with it the background watch) while any run is
// active: Android freezes a backgrounded app, and then no notification for
// "task completed", permissions or questions can be generated at all.
function syncKeepAlive() {
  setKeepAlive(activeRunSessionIDs().length > 0)
}

// Finish a run on the client without a server status event: clear the spinner,
// drop that run's clocks. Leaving a stale clock behind would make the NEXT send
// look silent immediately and could clear its sending flag before the server
// has persisted the new prompt.
function finishRunLocally(sessionID: string) {
  useEvents.setState((state) => ({
    sessionStatus: { ...state.sessionStatus, [sessionID]: { type: "idle" } },
    statusText: { ...state.statusText, [sessionID]: "" },
  }))
  useSessions.setState((state) => ({ sending: { ...state.sending, [sessionID]: false } }))
  sessionActivityAt.delete(sessionID)
  sessionResyncedAt.delete(sessionID)
  syncKeepAlive()
}

// --- Notifications ----------------------------------------------------------
//
// All of these are filtered by src/lib/notifications.ts, which stays silent
// while the app is in the foreground: they exist for the phone-in-pocket case.

function notifyPermissionPrompt(sessionID: string, id: string, force = false) {
  notify(
    {
      category: "permissions",
      title: i18n.t("notifications.titles.permission"),
      // Fixed body: the tool name, resources and command text are
      // server-supplied and must not reach the lock screen.
      body: i18n.t(PERMISSION_NOTIFICATION_KEY),
      sessionId: sessionID,
      dedupeKey: `perm-${id}`,
      dedupeCooldownMs: 60_000,
    },
    { force },
  )
}

function notifyQuestionPrompt(sessionID: string, id: string, force = false) {
  notify(
    {
      category: "questions",
      // Fixed title and body: the header/question text is
      // server-supplied (see PERMISSION_NOTIFICATION_KEY).
      title: i18n.t("notifications.titles.question"),
      body: i18n.t(QUESTION_NOTIFICATION_KEY),
      sessionId: sessionID,
      dedupeKey: `question-${id}`,
      dedupeCooldownMs: 60_000,
    },
    { force },
  )
}

// Runs ended by the recovery path (SSE stream dead while the phone was locked)
// rather than by a session.status event. The SSE branch and a resync can end
// the same run at the same moment; 15s of silence per session covers that
// without hiding a genuinely new run (a new busy status clears the mark).
const recoveredNotifiedAt = new Map<string, number>()
const RUN_END_NOTIFY_TTL_MS = 15_000

function notifyRunRecovered(sessionID: string, messages: Message[], force = false) {
  const notifiedAt = recoveredNotifiedAt.get(sessionID)
  if (notifiedAt !== undefined && Date.now() - notifiedAt < RUN_END_NOTIFY_TTL_MS) return
  // One notification per finished run, whichever path saw the end first.
  const dedupe = { dedupeKey: `end-${sessionID}`, dedupeCooldownMs: 20_000 }
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")
  if (lastAssistant?.error) {
    // No session.error event was delivered either, so this is the only place
    // the failure can surface.
    notify(
      {
        category: "errors",
        title: i18n.t("notifications.titles.error"),
        body: sanitizeBody(lastAssistant.error.message, i18n.t("notifications.bodies.error")),
        sessionId: sessionID,
        ...dedupe,
      },
      { force },
    )
  } else {
    const title = useSessions.getState().sessions.find((s) => s.id === sessionID)?.title
    notify(
      {
        category: "completed",
        title: i18n.t("notifications.titles.completed"),
        body: sanitizeBody(title, i18n.t("notifications.bodies.completed")),
        sessionId: sessionID,
        ...dedupe,
      },
      { force },
    )
  }
  recoveredNotifiedAt.set(sessionID, Date.now())
  for (const [id, at] of recoveredNotifiedAt) {
    if (Date.now() - at > RUN_END_NOTIFY_TTL_MS) recoveredNotifiedAt.delete(id)
  }
}

// Re-fetch pending permissions and questions from the server for a session.
// Called when entering a session to recover from missed SSE events or failed
// optimistic removals — and, while the app is backgrounded, by the background
// watch: a prompt created after the SSE socket died is only visible here.
// Every prompt has exactly one entry point: this function is called from the
// session screen, from reconnect recovery and from the background watch at the
// same time — two overlapping pulls would notify the same prompt twice.
const refreshing = new Set<string>()

export async function refreshPending(client: Client, sessionID: string, options: { background?: boolean } = {}) {
  if (refreshing.has(sessionID)) return
  refreshing.add(sessionID)
  try {
    const [perms, questions] = await Promise.all([client.permission.list(), client.question.list(sessionID)])
    const sessionPerms = (perms || []).filter((p: Record<string, unknown>) => p.sessionID === sessionID)
    const sessionQuestions = ((questions || []) as Array<{ id: string; sessionID: string; questions: unknown[] }>).filter(
      (q: Record<string, unknown>) => q.sessionID === sessionID,
    )
    const before = useEvents.getState()
    const knownPerms = before.permissions[sessionID] || []
    const knownQuestions = before.questions[sessionID] || []
    const freshPerms = sessionPerms.filter((p) => !knownPerms.some((known) => known.id === p.id))
    const freshQuestions = sessionQuestions.filter((q) => !knownQuestions.some((known) => known.id === q.id))
    useEvents.setState((state) => ({
      // BUG-011: permissions keep the merge-by-ID behavior — a reply is still
      // optimistically removed from the UI, so a server list that has not
      // caught up yet must not resurrect it.
      permissions: {
        ...state.permissions,
        [sessionID]: [
          ...(state.permissions[sessionID] || []).filter((p) => !sessionPerms.some((sp) => sp.id === p.id)),
          ...sessionPerms,
        ],
      },
      // Questions are the opposite: the list is server-authoritative. A form
      // created during an SSE outage must appear, and a form answered from the
      // terminal must disappear. Replies are no longer removed optimistically,
      // so there is no local entry that could be incorrectly resurrected.
      questions: {
        ...state.questions,
        [sessionID]: reconcilePendingQuestions(state.questions[sessionID] || [], sessionQuestions as any),
      },
    }))
    // Only prompts this client had not seen before notify; the store update
    // above is what the SSE handlers check, so a prompt that arrives both ways
    // still produces exactly one notification.
    for (const permission of freshPerms) {
      notifyPermissionPrompt(sessionID, (permission as { id: string }).id, options.background)
    }
    for (const question of freshQuestions) {
      notifyQuestionPrompt(sessionID, question.id, options.background)
    }
  } catch (err) {
    console.warn("[Events] Failed to refresh pending:", err)
  }
}

// Which sessions the server is actually executing. `null` when it cannot say
// (older server without /session/active, or unreachable) — callers then fall
// back to the transcript-tail heuristic.
async function activeSessionIDs(client: Client): Promise<Set<string> | null> {
  try {
    return new Set(await client.session.active())
  } catch {
    return null
  }
}

// Re-sync any session currently marked "busy" against the server after an
// SSE reconnect. sessionStatus/sending are SSE-driven and there is normally
// no other path to idle — if the server's busy -> idle `session.status`
// event fired while the network was down, SSE reconnect resumes the stream
// from "now" (it does not replay missed events), so without this the busy
// flag would never clear and the UI would show a stuck 'processing' spinner
// forever (issue #123).
//
// Only ever CLEARS a busy flag the server confirms is stale — via its
// /session/active record, or (older servers) isSessionActuallyIdle on the
// transcript — it never marks a session busy, so it can't clobber a genuinely
// still-busy session. Also re-checks sessionStatus right before writing, so a
// real session.status event that lands while the fetch is in flight (e.g. the
// session went busy again) wins over this resync.
async function resyncBusySessions(only?: ReadonlySet<string>, options: { background?: boolean } = {}) {
  const pendingSessionIDs = new Set(activeRunSessionIDs().filter((sessionID) => !only || only.has(sessionID)))
  if (pendingSessionIDs.size === 0) return

  await Promise.all(
    [...pendingSessionIDs].map(async (sessionID) => {
      try {
        const sessionsState = useSessions.getState()
        const session =
          sessionsState.sessions.find((s) => s.id === sessionID) ??
          (sessionsState.currentSession?.id === sessionID ? sessionsState.currentSession : undefined)
        const connState = useConnections.getState()
        const client = session?.directory
          ? connState.clientForDirectory(session.directory) ?? connState.client
          : connState.client
        if (!client) return

        const [response, active] = await Promise.all([
          client.session.messages(sessionID),
          activeSessionIDs(client),
        ])
        const messages = (response || []).map((m) => m.info)
        const viewing = () => useSessions.getState().currentSession?.id === sessionID
        // The server's active list is authoritative: a session it no longer
        // runs is idle even when its transcript ends on an unanswered prompt
        // (the run was cancelled server-side and the idle event was lost).
        // Without it such a run kept the spinner — and the sending flag that
        // blocks the composer — forever.
        const idle = active ? !active.has(sessionID) : isSessionActuallyIdle(messages)
        if (!idle) {
          // Still running server-side, but this client may simply have missed
          // the streamed parts: show everything the server already has, from
          // the response we already paid for.
          if (viewing()) useSessions.getState().applyServerMessages(response)
          return // server says still busy - leave the status alone
        }

        // A fresh session.status event may have landed on the SSE stream
        // while this fetch was in flight — that's authoritative, don't
        // stomp on it. No status at all is the optimistic-only case: the
        // transcript fetched above is then the only evidence we have.
        // `sending` counts as "no status yet": it is set by the send tap and
        // only cleared by a status event, so a run whose busy event never
        // arrived after the app was backgrounded is still covered.
        const latestStatus = useEvents.getState().sessionStatus[sessionID]
        if (latestStatus && latestStatus.type !== "busy" && !useSessions.getState().sending[sessionID]) return

        // The run ended while no session.status event could be delivered (the
        // socket dies when Android backgrounds the app). This is the only place
        // that can tell the user it finished.
        notifyRunRecovered(sessionID, messages, options.background)
        finishRunLocally(sessionID)
        if (viewing()) useSessions.getState().applyServerMessages(response)
      } catch (err) {
        // A session deleted elsewhere would otherwise be re-polled every quiet
        // window forever.
        if ((err as { status?: number } | null)?.status === 404) finishRunLocally(sessionID)
        console.warn("[Events] Failed to resync session status for", sessionID, err)
      }
    }),
  )
}

// V2's event stream is volatile: it resumes from "now" and never replays
// events emitted while the app was backgrounded or the socket was down. A
// question (or permission) created in that gap would otherwise stay invisible
// until the user manually re-opened the session. On reconnect, re-read both
// the current transcript and the pending prompts.
async function resyncCurrentSession() {
  const sessions = useSessions.getState()
  const current = sessions.currentSession
  if (!current) return

  const connState = useConnections.getState()
  const client = current.directory
    ? connState.clientForDirectory(current.directory) ?? connState.client
    : connState.client
  if (!client) return

  await Promise.allSettled([refreshPending(client, current.id), sessions.refreshMessages()])
}

// --- Background watch ------------------------------------------------------
//
// The notification module stays silent while the app is in the foreground, so
// every alert the user cares about is generated while the phone is in a pocket
// — exactly when the SSE socket is dead. Android kills the socket when the app
// leaves the foreground (the keep-alive service keeps the *process*, not the
// HTTP stream), and V2 never replays what was missed. Poll the server instead:
// pending prompts and run state are both readable, so notifications no longer
// depend on the stream surviving.
export const BACKGROUND_POLL_MS = 5_000

let backgroundPollTimer: ReturnType<typeof setInterval> | null = null
let appStateWatchInstalled = false
// What the server listed as running on the previous tick. The tick learns
// "this run ended" by comparing sets — no SSE, no local sessionStatus and no
// optimistic `sending` flag: all three are exactly what a backgrounded app
// cannot rely on, and all three were why the previous versions stayed silent.
let lastActiveSeen: Set<string> | null = null

function clientFor(sessionID: string): Client | null {
  const sessionsState = useSessions.getState()
  const session =
    sessionsState.sessions.find((s) => s.id === sessionID) ??
    (sessionsState.currentSession?.id === sessionID ? sessionsState.currentSession : undefined)
  const connState = useConnections.getState()
  return (session?.directory ? connState.clientForDirectory(session.directory) : undefined) ?? connState.client ?? null
}

async function notifyRunEnded(sessionID: string) {
  const client = clientFor(sessionID)
  if (!client) return
  try {
    const response = await client.session.messages(sessionID)
    notifyRunRecovered(sessionID, (response || []).map((m) => m.info), true)
    finishRunLocally(sessionID)
  } catch (err) {
    // A session deleted elsewhere is not a finished run.
    if ((err as { status?: number } | null)?.status === 404) finishRunLocally(sessionID)
    log.warn("watch", "could not read the transcript of", sessionID, String(err))
  }
}

async function pollWhileBackgrounded() {
  // Unconditional: the diagnostics block must show whether the timer runs at
  // all, which is the difference between "timer frozen" and "nothing to do".
  log.info("watch", `tick (${AppState.currentState})`)
  // The listener can fire late; trust the current state over the last event.
  if (AppState.currentState === "active") return
  const client = useConnections.getState().client
  if (!client) {
    log.warn("watch", "no client")
    return
  }

  // Server truth first: it knows which sessions run right now, including the
  // ones this app never saw a busy event for.
  const serverActive = await activeSessionIDs(client)
  const running = new Set(activeRunSessionIDs())
  if (serverActive) for (const id of serverActive) running.add(id)

  if (serverActive && lastActiveSeen) {
    for (const sessionID of lastActiveSeen) {
      if (!serverActive.has(sessionID)) {
        log.info("watch", "run ended:", sessionID)
        await notifyRunEnded(sessionID)
      }
    }
  }
  // First tick of a background period only takes a baseline: a run that ended
  // while the app was open was already handled by the SSE path.
  lastActiveSeen = serverActive ? new Set(serverActive) : null

  // Per session: permission.list is global and question.list is session-scoped,
  // and a session may live on another directory's connection.
  await Promise.allSettled(
    [...running].map((sessionID) => refreshPending(clientFor(sessionID) ?? client, sessionID, { background: true })),
  )
  // Servers without /session/active (V1) fall back to the local status recovery.
  if (!serverActive) await resyncBusySessions(undefined, { background: true })
}

export function startBackgroundWatch() {
  if (backgroundPollTimer) return
  log.info("watch", "started (app in background)")
  lastActiveSeen = null
  // Poll immediately: a run may already have finished while the app was being
  // put away, and 5s of silence for nothing is noticeable.
  void pollWhileBackgrounded()
  backgroundPollTimer = setInterval(() => {
    void pollWhileBackgrounded()
  }, BACKGROUND_POLL_MS)
}

export function stopBackgroundWatch() {
  if (!backgroundPollTimer) return
  log.info("watch", "stopped (app in foreground)")
  clearInterval(backgroundPollTimer)
  backgroundPollTimer = null
}

function installAppStateWatch() {
  if (appStateWatchInstalled) return
  appStateWatchInstalled = true
  AppState.addEventListener("change", (next) => {
    if (next === "active") stopBackgroundWatch()
    else if (next === "background") startBackgroundWatch()
  })
}

export const useEvents = create<EventsState>((set, get) => ({
  connected: false,
  authError: false,
  reconnectAttempts: 0,
  lastDisconnectAt: null,
  sessionStatus: {},
  statusText: {},
  permissions: {},
  questions: {},
  answeredQuestions: {},

  recordQuestionAnswer: (sessionID, request, answers) =>
    set((state) => ({
      answeredQuestions: {
        ...state.answeredQuestions,
        [sessionID]: recordAnswered(state.answeredQuestions[sessionID] || [], request, answers),
      },
    })),

  connect: () => {
    controller?.abort()
    controller = null
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    // Polling while backgrounded is the only notification path that survives a
    // dead socket (see pollWhileBackgrounded).
    installAppStateWatch()
    if (AppState.currentState === "background") startBackgroundWatch()
    else stopBackgroundWatch()

    const client = useConnections.getState().client
    if (!client) return

    controller = new AbortController()
    const currentController = controller
    set({ connected: true, authError: false })
    // Grace period: the watchdog measures silence from here until the first
    // chunk lands.
    lastStreamActivityAt = Date.now()
    console.log("[SSE] Connecting to event stream...")

    // Run in background
    ;(async () => {
      let reconnectScheduled = false
      // True if this connect() call is resuming after a prior disconnect —
      // gates the one-time busy-session resync below so a cold app start
      // (sessionStatus is always empty then) never triggers it, and a run of
      // failed retries can't re-arm the check on every attempt.
      const isReconnect = forceResyncOnConnect || get().reconnectAttempts > 0
      forceResyncOnConnect = false
      let resyncedAfterReconnect = false
      const stableTimer = setTimeout(() => {
        if (!currentController.signal.aborted) {
          set({ reconnectAttempts: 0, lastDisconnectAt: null })
        }
      }, STABLE_CONNECTION_MS)

      const scheduleReconnect = (reason: unknown) => {
        if (reconnectScheduled || currentController.signal.aborted) return
        reconnectScheduled = true
        const state = get()
        const reconnectAttempts = state.reconnectAttempts + 1
        const lastDisconnectAt = state.lastDisconnectAt ?? Date.now()
        const disconnectedFor = Date.now() - lastDisconnectAt
        set({ connected: false, reconnectAttempts, lastDisconnectAt })

        if (disconnectedFor >= PROLONGED_DISCONNECT_MS) {
          notify({
            category: "connection",
            title: i18n.t("notifications.titles.connection"),
            body: sanitizeBody(undefined, i18n.t("notifications.bodies.reconnecting")),
            sessionId: "",
            dedupeKey: "sse-prolonged-disconnect",
            dedupeCooldownMs: 60_000,
          })
        }

        const baseDelay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempts - 1, RECONNECT_DELAYS_MS.length - 1)]
        const jitteredDelay = Math.min(15_000, Math.round(baseDelay * (0.75 + Math.random() * 0.5)))
        console.warn(`[SSE] Connection lost, reconnecting in ${jitteredDelay}ms:`, reason)
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          get().connect()
        }, jitteredDelay)
      }

      // Two independent failure modes, both ending in a stuck "Working...":
      // a dead socket (whole-stream silence) and a healthy socket that stops
      // delivering one run's events (per-session silence). Check either.
      const stallWatchdog = setInterval(() => {
        if (currentController.signal.aborted || !get().connected) return
        const sessions = useSessions.getState()
        const now = Date.now()
        const runIDs = activeRunSessionIDs()

        const runs = runIDs.map((sessionID) => {
          // First sighting of a run starts its clock: a fresh send has no
          // event yet by definition.
          if (!sessionActivityAt.has(sessionID)) sessionActivityAt.set(sessionID, now)
          return {
            sessionID,
            lastEventAt: sessionActivityAt.get(sessionID)!,
            lastResyncAt: sessionResyncedAt.get(sessionID),
          }
        })
        const quiet = runsNeedingResync(runs, now)
        if (quiet.length > 0) {
          for (const sessionID of quiet) sessionResyncedAt.set(sessionID, now)
          console.warn("[SSE] No events for a running session - resyncing its transcript:", quiet.join(", "))
          void resyncBusySessions(new Set(quiet))
        }

        const activeRun =
          runIDs.length > 0 || Object.values(sessions.sending).some(Boolean)
        if (!isStreamStalled({ activeRun, lastActivityAt: lastStreamActivityAt, now })) return

        console.warn("[SSE] No stream activity during a run - resyncing and reconnecting")
        void resyncBusySessions()
        void resyncCurrentSession()
        get().connect()
      }, STALL_CHECK_MS)

      try {
        for await (const event of client.global.events(currentController.signal, () => {
          lastStreamActivityAt = Date.now()
          // A live byte after a reconnect (heartbeat included) means the
          // stream is back. Catch up on what was missed here, not on the
          // first parsed event: a server with nothing new to say sends only
          // heartbeats, which never reach the loop below, and the client
          // would stay stale after an outage that ended the run.
          if (isReconnect && !resyncedAfterReconnect) {
            resyncedAfterReconnect = true
            void resyncBusySessions()
            void resyncCurrentSession()
          }
        })) {
          if (currentController.signal.aborted) break

          const payload = (event as any).payload || event
          const type = payload.type as string
          const props = payload.properties || {}

          switch (type) {
            case "session.status": {
              const sessionID = props.sessionID as string
              const status = props.status as SessionStatus
              if (!sessionID) break
              // An idle run needs no recovery; forget its clocks so a later
              // send starts from a clean window.
              if (status.type === "idle") {
                sessionActivityAt.delete(sessionID)
                sessionResyncedAt.delete(sessionID)
              } else {
                markSessionActivity(sessionID)
              }
              const previous = get().sessionStatus[sessionID]
              const completed = previous?.type === "busy" && status.type === "idle"

              // A new run starts — forget any error/abort from the previous one
              if (status.type === "busy") {
                erroredSessions.delete(sessionID)
                abortedSessions.delete(sessionID)
                recoveredNotifiedAt.delete(sessionID)
              }

              set((state) => ({
                sessionStatus: { ...state.sessionStatus, [sessionID]: status },
                // Clear status text when idle
                statusText: status.type === "idle" ? { ...state.statusText, [sessionID]: "" } : state.statusText,
              }))

              // SSE is the source of truth — update sending state unconditionally
              if (status.type === "idle") {
                useSessions.setState((state) => ({
                  sending: { ...state.sending, [sessionID]: false },
                }))
                // Refresh messages if this is the session the user is viewing
                const sessions = useSessions.getState()
                if (sessions.currentSession?.id === sessionID) {
                  sessions.refreshMessages()
                }
              }

              if (completed) {
                // A user-cancelled run still ends busy -> idle; don't count it
                // as a received response or a review-worthy success.
                const aborted = abortedSessions.has(sessionID)
                // Only notify "Task completed" for a genuine completion — a
                // user-cancelled run didn't complete, and an errored run
                // already fired its own "Session error" notification (session.error
                // doesn't touch sessionStatus, so an errored session still lands
                // here via busy→idle). Without this guard the user gets a
                // misleading — or duplicate, contradictory — completion push.
                if (!aborted && !erroredSessions.has(sessionID)) {
                  const match = useSessions.getState().sessions.find((s) => s.id === sessionID)
                  notify({
                    category: "completed",
                    title: i18n.t("notifications.titles.completed"),
                    body: sanitizeBody(match?.title, i18n.t("notifications.bodies.completed")),
                    sessionId: sessionID,
                    // Same key as the background poll: when the socket resumes
                    // it replays the idle event for a run the poll already
                    // reported, and that must not buzz twice.
                    dedupeKey: `end-${sessionID}`,
                    dedupeCooldownMs: 20_000,
                  })
                }
              }
              syncKeepAlive()
              break
            }

            case "message.updated": {
              const info = props.info as Message | undefined
              if (!info) break
              markSessionActivity(info.sessionID)
              useSessions.getState().handleEvent({ type, properties: { info } } as any)
              break
            }

            case "message.part.updated": {
              const part = props.part as Part | undefined
              if (!part) break
              markSessionActivity((part as any).sessionID)

              // Update status text from the latest part
              const sessionID = (part as any).sessionID as string
              if (sessionID) {
                set((state) => ({
                  statusText: { ...state.statusText, [sessionID]: statusFromPart(part) },
                }))
              }

              useSessions.getState().handleEvent({ type, properties: { part } } as any)
              break
            }

            case "session.updated": {
              const info = props.info as Session | undefined
              if (!info) break
              useSessions.getState().handleEvent({ type, properties: { info } } as any)
              break
            }

            case "session.created": {
              const info = props.info as Session | undefined
              if (!info) break
              // Add to sessions list
              useSessions.setState((state) => {
                const exists = state.sessions.some((s) => s.id === info.id)
                if (exists) return {}
                return { sessions: [info, ...state.sessions] }
              })
              break
            }

            case "session.error": {
              const error = props.error as { message?: string } | undefined
              const sessionID = props.sessionID as string
              if (!sessionID) break
              // Mark so the eventual busy -> idle transition is not counted
              // as a success for the store review prompt
              erroredSessions.add(sessionID)
              markSessionActivity(sessionID)
              // Clear sending state unconditionally — SSE is truth
              useSessions.setState((state) => ({
                sending: { ...state.sending, [sessionID]: false },
                // Surface error only if user is viewing this session
                ...(state.currentSession?.id === sessionID
                  ? { error: error?.message || "Session error occurred" }
                  : {}),
              }))
              if (useSessions.getState().currentSession?.id === sessionID) {
                useSessions.getState().refreshMessages()
              }
              notify({
                category: "errors",
                title: i18n.t("notifications.titles.error"),
                body: sanitizeBody(error?.message, i18n.t("notifications.bodies.error")),
                sessionId: sessionID,
              })
              break
            }

            case "permission.asked": {
              const req = props as any
              if (!req.id || !req.sessionID) break
              const existing = get().permissions[req.sessionID] || []
              if (existing.some((item) => item.id === req.id)) break
              set((state) => ({
                permissions: {
                  ...state.permissions,
                  [req.sessionID]: [...(state.permissions[req.sessionID] || []), req],
                },
              }))
              notifyPermissionPrompt(req.sessionID, req.id)
              break
            }

            case "permission.replied": {
              const sessionID = props.sessionID as string
              const requestID = props.requestID as string
              if (!sessionID || !requestID) break
              set((state) => ({
                permissions: {
                  ...state.permissions,
                  [sessionID]: (state.permissions[sessionID] || []).filter((p) => p.id !== requestID),
                },
              }))
              break
            }

            case "question.asked": {
              const req = props as any
              if (!req.id || !req.sessionID) break
              const existing = get().questions[req.sessionID] || []
              if (existing.some((item) => item.id === req.id)) break
              set((state) => ({
                questions: {
                  ...state.questions,
                  [req.sessionID]: [...(state.questions[req.sessionID] || []), req],
                },
              }))
              notifyQuestionPrompt(req.sessionID, req.id)
              break
            }

            case "question.replied":
            case "question.rejected": {
              const sessionID = props.sessionID as string
              const requestID = props.requestID as string
              if (!sessionID || !requestID) break
              set((state) => ({
                questions: {
                  ...state.questions,
                  [sessionID]: (state.questions[sessionID] || []).filter((q) => q.id !== requestID),
                },
              }))
              break
            }
          }
        }

        scheduleReconnect(new Error("Event stream closed"))
      } catch (err) {
        if (isAuthError(err) && !currentController.signal.aborted) {
          // Bad credentials, not a transient failure — retrying forever just
          // spams Sentry and drains the battery with zero path to recovery
          // (issue #76: 309 events / 65 users). Stop and surface a distinct
          // state instead; the sessions screen offers a link to fix
          // credentials, which reconnects via connect() once saved.
          console.warn("[SSE] Authentication failed — stopping reconnect loop:", err)
          set({ connected: false, authError: true })
        } else {
          scheduleReconnect(err)
        }
      } finally {
        clearTimeout(stableTimer)
        clearInterval(stallWatchdog)
        if (currentController.signal.aborted) {
          console.log("[SSE] Disconnected (aborted)")
        }
      }
    })()
  },

  resumeFromBackground: (backgroundedForMs) => {
    if (!shouldReconnectOnResume(backgroundedForMs)) return
    // The OS may have killed the old socket without an error; aborting it also
    // drops whatever stale backlog it buffered, so the bubble cannot replay an
    // answer the transcript already shows. connect() cancels a pending backoff
    // too, and the resync flag makes the first byte re-read the open session.
    forceResyncOnConnect = true
    get().connect()
  },

  disconnect: () => {
    console.log("[SSE] Disconnecting")
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    controller?.abort()
    controller = null
    erroredSessions.clear()
    abortedSessions.clear()
    sessionActivityAt.clear()
    sessionResyncedAt.clear()
    set({
      connected: false,
      authError: false,
      reconnectAttempts: 0,
      lastDisconnectAt: null,
      sessionStatus: {},
      statusText: {},
      permissions: {},
      questions: {},
      answeredQuestions: {},
    })
  },
}))
