import { create } from "zustand"
import { ApiError, type Session, type Message, type Part, type Event, type MessageWithParts, type Client } from "../lib/sdk"
import { useConnections } from "./connections"
import { useSettings } from "./settings"
import { extractPromptFromParts, type PromptFromParts } from "../lib/prompt-from-parts"
import { mergeIncomingMessage, reconcileTemps } from "../lib/message-merge"
import { isColdSessionLoad, isLiveEventForSession } from "../lib/session-load-reconcile"
import { createPartBatcher } from "../lib/part-batch"
import { shouldApplyPartUpdate } from "../lib/part-order"
import { countTurns, isWholeSession, keepLoadedHistory, messageLimitForTurns, trimToTurns } from "../lib/message-page"
import { offlineHistory } from '../lib/history-storage'

// Helper to convert API response to our internal format
function parseMessages(response: MessageWithParts[]): { messages: Message[]; parts: Record<string, Part[]> } {
  const messages: Message[] = []
  const parts: Record<string, Part[]> = {}

  for (const item of response || []) {
    messages.push(item.info)
    parts[item.info.id] = item.parts || []
  }

  return { messages, parts }
}

// Most sessions one Recent list renders. Well above the old 50, which silently
// dropped sessions that were reachable from the TUI.
const SESSION_LIST_LIMIT = 800

function pageSize(): number {
  return useSettings.getState().pageSize
}

// Batched `message.part.updated` application — see part-batch.ts.
const partBatcher = createPartBatcher<Part>((part) => part.id, (batch) => applyParts(batch))

function applyParts(batch: Part[]) {
  useSessions.setState((state) => {
    if (!state.currentSession) return {}
    const parts = { ...state.parts }
    let applied = false
    for (const part of batch) {
      if (part.sessionID && part.sessionID !== state.currentSession.id) continue
      const messageParts = parts[part.messageID] || []
      const existing = messageParts.find((p) => p.id === part.id)
      if (!existing) {
        parts[part.messageID] = [...messageParts, part]
      } else if (shouldApplyPartUpdate(existing, part)) {
        parts[part.messageID] = messageParts.map((p) => (p.id === part.id ? part : p))
      }
      // A rejected stale update is still proof of life: clear a stuck spinner.
      applied = true
    }
    if (!applied) return {}
    // A live part update is proof of life — clear any stuck spinner (see
    // message.updated in handleEvent).
    return { parts, isLoading: false }
  })
}

interface SessionsState {
  sessions: Session[]
  currentSession: Session | null
  messages: Message[]
  parts: Record<string, Part[]>
  isLoading: boolean
  // Per-session optimistic sending flag — bridging gap between user tap and SSE busy
  sending: Record<string, boolean>
  loadingMore: boolean
  hasMore: boolean
  error: string | null

  // Actions
  loadSessions: () => Promise<void>
  selectSession: (sessionID: string, directory?: string) => Promise<void>
  loadOlderMessages: () => Promise<void>
  createSession: (title?: string) => Promise<Session | null>
  deleteSession: (sessionID: string) => Promise<void>
  sendMessage: (
    text: string,
    model?: { providerID: string; modelID: string },
    agent?: string,
    files?: Array<{ uri: string; mime: string; filename?: string; base64?: string }>,
    variant?: string,
  ) => Promise<void>
  /** Returns false when the server refused: the run is still going. */
  abortSession: () => Promise<boolean>
  refreshMessages: () => Promise<void>
  /** Apply a transcript that the caller already fetched, without a second GET. */
  applyServerMessages: (response: MessageWithParts[]) => void

  // Revert (edit sent message) / unrevert (undo the pending revert)
  revertToMessage: (messageID: string) => Promise<RevertResult>
  unrevertSession: () => Promise<void>

  // Event handling
  handleEvent: (event: Event) => void
}

export type RevertResult = ({ ok: true } & PromptFromParts) | { ok: false; reason: "unsupported" | "auth" | "error" }

// Sessions the user aborted since they last went busy. Mirrors events.ts's
// erroredSessions: SessionStatus has no "aborted" variant — an aborted run
// still ends with a busy -> idle transition — so without this mark a
// user-cancelled run would count as response_received in analytics and as a
// success toward the store review prompt. events.ts (which already imports
// this module) clears entries on busy and checks them on busy -> idle.
export const abortedSessions = new Set<string>()

// Monotonic token guarding selectSession against out-of-order resolution: a
// slow fetch for a session the user has already navigated away from must not
// overwrite the messages/currentSession of a newer selection. Each call takes
// the next value and only commits its result if still the latest.
let selectSeq = 0
let loadOlderSeq = 0
let refreshSeqCounter = 0
let connectionEpoch = 0

// Get the right client for a session's directory
function clientFor(directory?: string): Client | null {
  const connState = useConnections.getState()
  if (!directory) return connState.client
  const connDir = connState.activeConnection?.directory
  if (directory !== connDir) return connState.clientForDirectory(directory)
  return connState.client
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: [],
  currentSession: null,
  messages: [],
  parts: {},
  isLoading: false,
  sending: {},
  loadingMore: false,
  hasMore: false,
  error: null,

  loadSessions: async () => {
    const epoch = connectionEpoch
    const connState = useConnections.getState()
    // Use a directory-less client so the server returns sessions from ALL projects,
    // not just the one matching the active connection's directory header.
    const client = connState.clientForDirectory(undefined) || connState.client
    if (!client) {
      set({ error: "No active connection" })
      return
    }

    try {
      set({ isLoading: true, error: null })
      // A directory-less list includes sessions across projects. Each row carries
      // its own directory into the session route so subsequent operations stay scoped.
      // The cap only bounds what one screen renders; the transport pages through
      // the server's cursor, and 50 used to hide older sessions the TUI still has.
      const sessions = await client.session.list({ roots: true, limit: SESSION_LIST_LIMIT })
      if (epoch !== connectionEpoch) return
      // BUG-010: merge by ID instead of wholesale replace — a session.created SSE
      // event that landed mid-flight must not be clobbered by a stale list fetch.
      const existingById = new Map(get().sessions.map((s) => [s.id, s]))
      sessions.forEach((s) => existingById.set(s.id, s))
      set({ sessions: [...existingById.values()], isLoading: false })
    } catch (error) {
      if (epoch !== connectionEpoch) return
      set({ error: "Failed to load sessions", isLoading: false })
    }
  },

  selectSession: async (sessionID, directory) => {
    // Use directory-specific client if the session belongs to a different project
    const connState = useConnections.getState()
    const client = directory ? connState.clientForDirectory(directory) : connState.client
    if (!client) {
      set({ error: "No active connection" })
      return
    }

    const seq = ++selectSeq
    // Re-selecting the session already shown on screen (e.g. #121's
    // useFocusEffect resync firing again on re-entry) is a background
    // refresh, not a cold load: the screen already has this session's
    // messages, and live SSE updates keep flowing to them the whole time.
    // Forcing isLoading back to true here would hide the entire
    // conversation — including anything streaming in live right now —
    // behind a spinner for as long as this redundant fetch takes, and if it
    // stalls (flaky network), the screen looks permanently stuck "loading"
    // until the user backs out and re-enters (issue #150). Only a
    // genuinely new/different session needs the blocking spinner.
    const isColdLoad = isColdSessionLoad(get().currentSession?.id, sessionID)
    // Captured before the reset below: a session whose whole transcript is
    // already in the store (loadOlderMessages cleared hasMore) must not lose
    // its older messages to this refresh's trimmed page.
    const alreadyLoadedAll = !isColdLoad && !get().hasMore && get().messages.length > 0
    try {
      // Reset optimistic sending — SSE sessionStatus is the source of truth
      set((state) => ({
        isLoading: isColdLoad ? true : state.isLoading,
        error: null,
        hasMore: false,
        loadingMore: false,
        sending: { ...state.sending, [sessionID]: false },
      }))

      const turns = pageSize()
      const limit = messageLimitForTurns(turns)
      // "Whole session" is the setting's max: ask for the transcript itself
      // instead of a page, then trimToTurns keeps all of it.
      const [session, firstPage] = await Promise.all([
        client.session.get(sessionID),
        isWholeSession(turns) ? client.session.allMessages(sessionID) : client.session.messages(sessionID, { limit }),
      ])

      // A newer selectSession started while we were fetching — discard this
      // stale result so it can't clobber the newer selection.
      if (seq !== selectSeq) return

      // One prompt can produce many records (a step per tool call), so a full
      // page may still hold fewer exchanges than requested. The API caps a page
      // at 200 messages, so in that case ask for the session once without a
      // limit rather than paging blindly.
      let response = firstPage
      if (!isWholeSession(turns) && firstPage.length >= limit && countTurns(parseMessages(firstPage).messages) < turns) {
        response = await client.session.messages(sessionID)
        if (seq !== selectSeq) return
      }

      // Parse the API response format: array of { info, parts }
      const parsed = parseMessages(response)
      // The page is measured in exchanges, not messages (see message-page.ts).
      const page = trimToTurns(parsed.messages, turns)
      const prevMessages = get().currentSession?.id === sessionID ? get().messages : []
      const messages = keepLoadedHistory(page.messages, prevMessages, alreadyLoadedAll)
      const parts: Record<string, Part[]> = {}
      for (const message of messages) {
        parts[message.id] = parsed.parts[message.id] ?? get().parts[message.id] ?? []
      }

      // Reconcile optimistic temp messages with the server list: a temp whose
      // real copy is now in the list is dropped (otherwise the message shows
      // twice, and reloads accumulate the dupes), in-flight temps are kept.
      const merged = reconcileTemps(messages, parts, prevMessages, get().parts)

      set({
        currentSession: session,
        messages: merged.messages,
        parts: { ...merged.parts },
        isLoading: false,
        // Older exchanges were left out — offer "load older". Nothing is older
        // when the refresh kept the history it already had.
        hasMore: messages.length > page.messages.length ? false : page.trimmed,
      })
    } catch (err) {
      if (seq !== selectSeq) return
      console.error("Failed to load session:", err)
      set({ error: "Failed to load session", isLoading: false })
    }
  },

  loadOlderMessages: async () => {
    const client = clientFor(get().currentSession?.directory)
    const session = get().currentSession
    if (!client || !session) return
    if (get().loadingMore || !get().hasMore) return

    // BUG-008: seq-guard — a stale fetch must not clobber newer messages,
    // same pattern as selectSession (const seq = ++loadSeq; if (seq !== loadSeq) return).
    const loadSeq = ++loadOlderSeq

    try {
      set({ loadingMore: true })

      // Fetch the whole transcript. `messages()` without a limit returned the
      // server default of 50, and this path then set hasMore=false — everything
      // older than that page became unreachable with no way to ask again.
      const response = await client.session.allMessages(session.id)
      if (loadSeq !== loadOlderSeq) return // stale result — discard

      const { messages: all, parts: allParts } = parseMessages(response)

      // Merge: use all messages from full fetch, but reconcile any
      // optimistic temp messages the same way as everywhere else.
      const existing = get().messages
      const merged = reconcileTemps(all, allParts, existing, get().parts)

      set({
        messages: merged.messages,
        parts: { ...merged.parts },
        loadingMore: false,
        hasMore: false, // We loaded everything
      })
    } catch (error) {
      console.error("Failed to load older messages:", error)
      set({ loadingMore: false })
    }
  },

  createSession: async (title) => {
    const epoch = connectionEpoch
    const connState = useConnections.getState()
    const client = connState.client
    if (!client) {
      set({ error: "No active connection" })
      return null
    }

    try {
      const created = await client.session.create({ title })
      if (epoch !== connectionEpoch) return null
      // Don't optimistically add to sessions list — let loadSessions() handle it
      // to avoid duplicate key errors from race conditions
      set({
        currentSession: created,
        messages: [],
        parts: {},
        hasMore: false,
        loadingMore: false,
      })
      return created
    } catch (error) {
      if (epoch !== connectionEpoch) return null
      set({ error: "Failed to create session" })
      return null
    }
  },

  deleteSession: async (sessionID) => {
    const epoch = connectionEpoch
    const connection = useConnections.getState().activeConnection?.id
    const session = get().sessions.find((s) => s.id === sessionID)
    const client = clientFor(session?.directory)
    if (!client) {
      set({ error: "No active connection" })
      return
    }

    try {
      await client.session.delete(sessionID)
      if (connection) await offlineHistory.remove(connection, sessionID)
      if (epoch !== connectionEpoch) return
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== sessionID),
        currentSession: state.currentSession?.id === sessionID ? null : state.currentSession,
        messages: state.currentSession?.id === sessionID ? [] : state.messages,
        parts: state.currentSession?.id === sessionID ? {} : state.parts,
      }))
    } catch (error) {
      if (epoch !== connectionEpoch) return
      set({ error: "Failed to delete session" })
    }
  },

  sendMessage: async (text, model, agent, files, variant) => {
    const epoch = connectionEpoch
    const client = clientFor(get().currentSession?.directory)
    const session = get().currentSession
    if (!client || !session) {
      set({ error: "No active session" })
      return
    }

    // BUG-009: capture ts before the try so the catch block can remove the
    // optimistic temp message on send failure.
    const ts = Date.now()

    try {
      set((state) => ({ sending: { ...state.sending, [session.id]: true }, error: null }))

      const userMessage: Message = {
        id: `temp-${ts}`,
        sessionID: session.id,
        role: "user",
        time: { created: ts },
        model,
        agent,
      }
      const optimisticParts: Part[] = []
      if (text) {
        optimisticParts.push({
          id: `temp-part-text-${ts}`,
          messageID: userMessage.id,
          type: "text",
          text,
        })
      }
      if (files) {
        for (let i = 0; i < files.length; i++) {
          const f = files[i]
          optimisticParts.push({
            id: `temp-part-file-${ts}-${i}`,
            messageID: userMessage.id,
            type: "file",
            mime: f.mime,
            url: f.uri,
            filename: f.filename,
          })
        }
      }

      set((state) => ({
        messages: [...state.messages, userMessage],
        parts: { ...state.parts, [userMessage.id]: optimisticParts },
      }))

      // Build prompt parts - images are already converted to JPEG with base64 by toJpeg()
      const promptParts: Array<
        { type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }
      > = []
      if (text) {
        promptParts.push({ type: "text", text })
      }
      if (files) {
        for (const f of files) {
          const url = f.base64 ? `data:${f.mime};base64,${f.base64}` : f.uri
          promptParts.push({ type: "file", mime: f.mime, url, filename: f.filename })
        }
      }

      // Await submission (POST to /prompt_async resolves fast, well before the
      // streamed response) so a failure here can propagate to the caller — SSE
      // events still update messages/parts/status in real-time on success.
      await client.session.prompt(session.id, { parts: promptParts, model, agent, variant })
      if (epoch !== connectionEpoch) return

      // V2 has no user-message SSE event: without a follow-up fetch the
      // optimistic temp message is the only copy of what was just sent and
      // can be replaced/lost by any full reload that races the server list.
      // Reconcile shortly after the POST resolves so the real user message
      // (already persisted server-side — the TUI sees it immediately) lands
      // in the list, and once more for slow servers.
      const scheduleReconcile = (delayMs: number) =>
        setTimeout(() => {
          const state = get()
          if (epoch === connectionEpoch && state.currentSession?.id === session.id) void state.refreshMessages()
        }, delayMs)
      scheduleReconcile(1_200)
      scheduleReconcile(4_000)
    } catch (err) {
      if (epoch !== connectionEpoch) throw err
      console.error("[sendMessage] error:", err)
      const stillCurrent = get().currentSession?.id === session.id
      set((state) => ({
        ...(stillCurrent ? { error: String(err) } : {}),
        sending: { ...state.sending, [session.id]: false },
        // BUG-009: remove the optimistic temp message on send failure so it
        // doesn't remain as a ghost bubble in the chat.
        messages: stillCurrent
          ? state.messages.filter((m) => !(m.id.startsWith("temp-") && m.sessionID === session.id))
          : state.messages,
        parts: stillCurrent
          ? Object.fromEntries(
              Object.entries(state.parts).filter(([id]) => !(id.startsWith("temp-") && id.endsWith(`-${ts}`))),
            )
          : state.parts,
      }))
      if (stillCurrent) get().refreshMessages()
      throw err
    }
  },

  abortSession: async () => {
    const epoch = connectionEpoch
    const client = clientFor(get().currentSession?.directory)
    const session = get().currentSession
    if (!client || !session) return false

    try {
      await client.session.abort(session.id)
      if (epoch !== connectionEpoch) return false
      // Mark only after the abort request succeeded — if it failed, the run
      // continues and any eventual completion is a genuine response.
      abortedSessions.add(session.id)
      set((state) => ({ sending: { ...state.sending, [session.id]: false } }))
      return true
    } catch {
      if (epoch !== connectionEpoch) return false
      set({ error: "Failed to abort session" })
      return false
    }
  },

  applyServerMessages: (response) => {
    const { messages, parts } = parseMessages(response)
    // Same temp reconciliation as refreshMessages: an optimistic message whose
    // server copy is in this transcript must not be duplicated.
    const merged = reconcileTemps(messages, parts, get().messages, get().parts)
    set({ messages: merged.messages, parts: { ...merged.parts } })
  },

  refreshMessages: async () => {
    const client = clientFor(get().currentSession?.directory)
    const session = get().currentSession
    if (!client || !session) return

    // BUG-008: seq-guard — same pattern as selectSession.
    const refreshSeq = ++refreshSeqCounter

    try {
      const response = await client.session.messages(session.id)
      if (refreshSeq !== refreshSeqCounter) return // stale result — discard

      const { messages: fetched, parts: fetchedParts } = parseMessages(response)
      // Reconcile optimistic temps with the server list: a just-sent message
      // whose copy is not yet in the list keeps its temp (V2 has no
      // user-message SSE event), while temps already covered by the server
      // history are dropped instead of duplicating it on every reload.
      const merged = reconcileTemps(fetched, fetchedParts, get().messages, get().parts)
      set({
        messages: merged.messages,
        parts: { ...merged.parts },
      })
    } catch (error) {
      if (refreshSeq !== refreshSeqCounter) return
      set({ error: "Failed to refresh messages" })
    }
  },

  // Marks messageID (and everything after it) as pending revert, so the
  // user can re-edit and resend it. The server keeps the underlying
  // messages until the next prompt runs cleanup, or unrevertSession() below
  // undoes it — so this only flips session.revert, it doesn't delete
  // anything itself. Returns the reverted message's text/files so the
  // caller can prefill the composer.
  revertToMessage: async (messageID) => {
    const epoch = connectionEpoch
    const client = clientFor(get().currentSession?.directory)
    const session = get().currentSession
    if (!client || !session) return { ok: false, reason: "error" }

    try {
      const updated = await client.session.revert(session.id, messageID)
      if (epoch !== connectionEpoch) return { ok: false, reason: 'error' }
      set((state) => ({
        currentSession: state.currentSession?.id === session.id ? updated : state.currentSession,
      }))
      return { ok: true, ...extractPromptFromParts(get().parts[messageID]) }
    } catch (err) {
      if (epoch !== connectionEpoch) return { ok: false, reason: 'error' }
      if (err instanceof ApiError) {
        // Older servers (pre session.revert) 404 on this route — degrade
        // gracefully instead of surfacing a generic error.
        if (err.status === 404) return { ok: false, reason: "unsupported" }
        // Expired/invalid credentials — distinct from a generic failure so
        // the caller can point the user at reconnecting rather than "retry".
        if (err.status === 401 || err.status === 403) return { ok: false, reason: "auth" }
      }
      console.error("Failed to revert message:", err)
      set({ error: "Failed to revert message" })
      return { ok: false, reason: "error" }
    }
  },

  unrevertSession: async () => {
    const epoch = connectionEpoch
    const client = clientFor(get().currentSession?.directory)
    const session = get().currentSession
    if (!client || !session) return

    try {
      const updated = await client.session.unrevert(session.id)
      if (epoch !== connectionEpoch) return
      set((state) => ({
        currentSession: state.currentSession?.id === session.id ? updated : state.currentSession,
      }))
    } catch (err) {
      if (epoch !== connectionEpoch) return
      console.error("Failed to unrevert session:", err)
      set({ error: "Failed to restore reverted messages" })
    }
  },

  handleEvent: (event) => {
    const { currentSession } = get()
    if (!currentSession) return

    const props = (event as any).properties || {}

    switch (event.type) {
      case "message.updated": {
        const message = (props.info || props.message) as Message | undefined
        if (!message || !isLiveEventForSession(message.sessionID, currentSession.id)) return

        set((state) => ({
          messages: mergeIncomingMessage(state.messages, message),
          // A live update for the session on screen is proof it has content
          // to show — clear any stuck spinner even if the initial (or a
          // redundant re-focus) GET hasn't resolved yet, or never does
          // (issue #150). Only ever clears, never sets it back to true.
          isLoading: false,
        }))
        break
      }

      case "message.part.updated": {
        const part = props.part as Part | undefined
        if (!part) return
        // Only handle parts for current session
        if (part.sessionID && part.sessionID !== currentSession.id) return
        // Queued, not applied: a delta carries the whole accumulated text, and
        // a backgrounded session resumes with thousands of them at once (see
        // part-batch.ts).
        partBatcher.push(part)
        break
      }

      case "message.removed": {
        const messageID = props.messageID as string
        if (!messageID) return
        set((state) => ({
          messages: state.messages.filter((m) => m.id !== messageID),
          parts: Object.fromEntries(Object.entries(state.parts).filter(([k]) => k !== messageID)),
        }))
        break
      }

      case "session.updated": {
        const session = (props.info || props) as Session | undefined
        if (!session?.id) return

        set((state) => ({
          sessions: state.sessions.map((s) => (s.id === session.id ? session : s)),
          currentSession: state.currentSession?.id === session.id ? session : state.currentSession,
          isLoading: isLiveEventForSession(session.id, state.currentSession?.id) ? false : state.isLoading,
        }))
        break
      }
    }
  },
}))

// Invalidate every in-flight request before exposing another server's client.
// Session IDs may overlap across servers; never merge or cache them together.
useConnections.subscribe((state, previous) => {
  if (state.activeConnection?.id === previous.activeConnection?.id && state.activeConnection?.url === previous.activeConnection?.url) return
  connectionEpoch++
  selectSeq++
  loadOlderSeq++
  refreshSeqCounter++
  partBatcher.dispose()
  useSessions.setState({ sessions: [], currentSession: null, messages: [], parts: {}, sending: {}, isLoading: false, hasMore: false, loadingMore: false, error: null })
})
