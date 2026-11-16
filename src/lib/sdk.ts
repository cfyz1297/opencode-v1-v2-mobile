// SDK client wrapper for React Native
// We create our own lightweight client that mirrors the opencode SDK patterns
// but works in React Native environment
// expo/fetch provides WinterCG-compliant fetch with ReadableStream support for SSE
//
// NOTE (V2): the app still consumes the V1-shaped client below (see AGENTS.md);
// every method now talks to the opencode V2 HTTP API and maps payloads through
// src/lib/v2-compat.ts so stores/screens stay untouched.
import { fetch as expoFetch } from "expo/fetch"
import { CONNECT_TIMEOUT_MS, dialStream, SSEParser } from "./sse"
import { ApiError, apiErrorFor } from "./api-error"
import { createHeaders, fetchWithTimeout, request } from "./http"
import { detectServerApi, type ProbeRequest, type ServerApi, type ServerIdentity } from "./api-detect"
import { createV1Client } from "./sdk-v1"
import { normalizeSessions } from "./session-list"
import { MAX_MESSAGE_LIMIT } from "./message-page"
import type { FileRoot } from "./file-roots"
import {
  buildFormAnswer,
  clampMessageLimit,
  joinPath,
  mapAgents,
  mapCommands,
  mapFileEntries,
  mapForms,
  mapMessages,
  mapPermissions,
  mapProjectFromLocation,
  mapProjects,
  mapProviders,
  mapSession,
  unwrapData,
  V2EventAdapter,
} from "./v2-compat"
import type { ProviderCatalog, V2FormField, V2FormInfo, V2MessageBody, V2SessionInfo } from "./v2-compat"
import { connectKeyAttempts, shouldTryNextConnectEndpoint } from "./provider-auth"
export { ApiAuthError, isAuthError } from "./api-error"

export interface ClientConfig {
  baseUrl: string
  directory?: string
  auth?: {
    username: string
    password: string
  }
  // Which server API this connection speaks. Omitted means V2 (the app's
  // original transport); stores/connections.ts probes the server once and
  // records the answer on the connection.
  api?: ServerApi
}

export interface Session {
  id: string
  slug: string
  projectID: string
  directory: string
  parentID?: string
  title: string
  version: string
  share?: { url: string }
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
    // Stamped by the V2 server when a run starts/finishes. `idle` is the only
    // evidence that a subagent session finished before this app connected.
    busy?: number
    idle?: number
  }
  summary?: {
    additions: number
    deletions: number
    files: number
  }
  // Session-wide totals reported by the server (V2 `/api/session/{id}`). The
  // message page is not the whole session, so this is what "spent on the whole
  // session" has to come from.
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning?: number
    cache?: { read: number; write: number }
  }
  // Present while a message (and everything after it) is pending revert —
  // the server keeps the underlying messages until the next prompt/summarize
  // call runs cleanup (or the revert is undone via session.unrevert).
  revert?: {
    messageID: string
    partID?: string
  }
}

export interface Message {
  id: string
  sessionID: string
  role: "user" | "assistant" | "system"
  parentID?: string
  time: {
    created: number
    completed?: number
  }
  // User message fields
  agent?: string
  model?: { providerID: string; modelID: string }
  // Assistant message fields
  modelID?: string
  providerID?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning?: number
    cache?: { read: number; write: number }
  }
  error?: { message: string }
  finish?: string
}

// API returns messages with parts embedded
export interface MessageWithParts {
  info: Message
  parts: Part[]
}

export interface Part {
  id: string
  sessionID?: string
  messageID: string
  type:
    | "text"
    | "reasoning"
    | "tool"
    | "file"
    | "snapshot"
    | "patch"
    | "step-start"
    | "step-finish"
    | "subtask"
    | "retry"
    | "compaction"
    | "agent"
  // Text / reasoning / compaction part
  text?: string
  // Compaction part (V2 message type "compaction"): server status plus the
  // reason it was started manually/automatically.
  status?: string
  reason?: string
  // Tool part
  tool?: string
  callID?: string
  state?: {
    status: "pending" | "running" | "completed" | "error"
    input?: unknown
    output?: unknown
    title?: string
    error?: { message: string }
    time?: { start?: number; end?: number }
    // Provider-supplied extras. `subagent` puts the child session id here
    // (metadata.sessionID), which is what lets the transcript link to it.
    metadata?: Record<string, unknown>
  }
  // Timing
  time?: { start?: number; end?: number }
  // File part
  mime?: string
  url?: string
  filename?: string
}

export interface Agent {
  name: string
  // Server-side identifier used by the V2 agent switch endpoint. V2 returns
  // display-case names ("Build") but expects the lowercase id ("build") —
  // switching by display name is accepted (204) yet silently kills the next
  // prompt (no events, empty assistant message), so always send `id`.
  id?: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  topP?: number
  temperature?: number
  color?: string
  model?: { modelID: string; providerID: string }
  prompt?: string
  options: Record<string, unknown>
  steps?: number
}

export interface Command {
  name: string
  description?: string
  agent?: string
  model?: string
  mcp?: boolean
  template: string
  subtask?: boolean
  hints: string[]
}

export interface Project {
  id: string
  name?: string
  path: {
    cwd: string
    root: string
    absolute: string
  }
}

export interface FileEntry {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
}

export interface Event {
  type: string
  properties: Record<string, unknown>
}

export interface HealthResponse {
  healthy: boolean
  version: string
}

export { ApiError }

function createV2Client(config: ClientConfig) {
  // Session IDs and switch choices belong to this connection. Sharing this
  // cache across clients can skip the first model switch on another server.
  const lastSwitch = new Map<string, string>()
  // Retain deltas across reconnects of this client, but never carry messages
  // or deduplication state into another server/directory connection.
  const eventAdapter = new V2EventAdapter()
  // Normalize once: a trailing slash on baseUrl (e.g. pasted into Advanced
  // mode or the Edit screen) would otherwise survive into every
  // `${config.baseUrl}${path}` concatenation below as a double slash, which
  // every request then fails against (while the diagnostics probe, which
  // reconstructs a clean URL, reports "works now"). A bare URL with no
  // trailing slash is untouched.
  config = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") }

  // Fetch one session through V2 and map it into the V1 shape. V2 wraps the
  // payload in {data}; tolerate bare bodies too.
  const getSession = async (sessionID: string): Promise<Session> => {
    const raw = unwrapData<V2SessionInfo>(await request(config, `/api/session/${sessionID}`))
    return mapSession(raw, config.directory)
  }

  // Directory-less GET /api/session returns sessions across ALL locations
  // (verified on V2), so the Recent Sessions list works without the user
  // picking a folder first — same reason V1 preferred /experimental/session.
  // The server defaults to the newest 50, which silently hid older sessions
  // that the TUI still lists, so walk the cursor until the list is complete
  // (or the cap is reached). The UI has no "load more" affordance.
  const SESSION_PAGE_SIZE = 200
  const SESSION_PAGES = 4
  const listSessions = async (): Promise<Session[]> => {
    const out: V2SessionInfo[] = []
    let cursor: string | null | undefined
    for (let page = 0; page < SESSION_PAGES; page++) {
      const query = new URLSearchParams({ limit: String(SESSION_PAGE_SIZE) })
      if (cursor) query.set("cursor", cursor)
      const body = await request<{ data?: V2SessionInfo[]; cursor?: { next?: string | null } }>(
        config,
        `/api/session?${query.toString()}`,
      )
      const rows = Array.isArray(body?.data) ? body.data : []
      out.push(...rows)
      cursor = body?.cursor?.next ?? null
      if (!cursor || rows.length < SESSION_PAGE_SIZE) break
    }
    return out.map((s) => mapSession(s, config.directory))
  }

  // Shape the raw global list the way the list UI expects (roots filter +
  // search + sort-by-updated + limit) — mirrors what normalizeSessions did
  // behind loadSessionList for the V1 experimental route.
  const listSessionsShaped = async (params?: { roots?: boolean; limit?: number; search?: string }) => {
    const all = await listSessions()
    return normalizeSessions(all, params)
  }

  return {
    global: {
      // `timeoutMs` overrides the default REQUEST_TIMEOUT_MS — used by the
      // onboarding connection test to fail fast on a bad/unreachable IP
      // instead of hanging for the full 30s (issue: first-run bounce).
      health: async (timeoutMs?: number): Promise<HealthResponse> => {
        const info = await request<{ version?: string; healthy?: boolean }>(config, "/api/info", {}, timeoutMs)
        return { healthy: info?.healthy ?? true, version: info?.version ?? "unknown" }
      },
      // SSE event stream - returns async iterator of V1-shaped events
      // Pass an AbortSignal to cancel the connection. `onActivity` fires for
      // every chunk, including `: heartbeat` comments the parser drops, so the
      // caller can tell a dead socket from a quiet one (see stream-watchdog).
      async *events(signal?: AbortSignal, onActivity?: () => void): AsyncGenerator<Event> {
        const url = `${config.baseUrl}/api/event`
        const headers = createHeaders(config) as Record<string, string>
        // Remove Content-Type for SSE (it's text/event-stream)
        delete headers["Content-Type"]
        // Ask for the stream uncompressed: a buffering proxy/gzip layer would
        // hold every event until the connection closes.
        headers["Accept-Encoding"] = "identity"

        // Must use expo/fetch for ReadableStream support on native.
        //
        // Headers must arrive within CONNECT_TIMEOUT_MS (see dialStream): a
        // black-holed host accepts the socket and then never answers, so
        // without this the stream hangs forever, no event ever arrives, and
        // the caller has already reported "connected". Aborting turns that
        // into a normal reconnect cycle.
        const response = await dialStream(expoFetch, url, { headers, signal }, CONNECT_TIMEOUT_MS)
        if (!response.ok || !response.body) {
          throw apiErrorFor(response.status, `Failed to connect to event stream: ${response.status}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        const parser = new SSEParser()

        let receivedFirstByte = false
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              console.log("[SSE] stream ended")
              break
            }
            onActivity?.()

            if (!receivedFirstByte) {
              receivedFirstByte = true
              console.log(`[SSE] first byte received (${value?.byteLength ?? 0} bytes)`)
            }

            for (const data of parser.push(decoder.decode(value, { stream: true }))) {
              let envelope
              try {
                envelope = JSON.parse(data)
              } catch (err) {
                console.warn("[SSE] Failed to parse event", {
                  length: data.length,
                  error: err instanceof Error ? err.message : String(err),
                })
                continue
              }

              // Sessions mutate through a handful of V2 event types that only
              // carry {sessionID, title/slug...} — refetch the full Session
              // so the stores' full-row merge keeps every field intact.
              if (envelope.type === "session.created" || envelope.type === "session.renamed") {
                const sessionID = envelope.data?.sessionID as string | undefined
                if (!sessionID) continue
                try {
                  const info = await getSession(sessionID)
                  yield { type: envelope.type === "session.renamed" ? "session.updated" : "session.created", properties: { info } }
                } catch (err) {
                  console.warn("[SSE] Failed to refetch session after", envelope.type, err)
                }
                continue
              }

              for (const mapped of eventAdapter.adapt(envelope)) {
                yield mapped
              }
            }

            // A resume from the background delivers the buffered backlog in a
            // single burst: reader.read() resolves immediately, so every
            // iteration is a microtask and no screen update, tap or navigation
            // gets a turn until the whole backlog is drained. One macrotask per
            // chunk (a few per second while streaming live) keeps the UI alive.
            await new Promise((resolve) => setTimeout(resolve, 0))
          }
        } finally {
          reader.releaseLock()
        }
      },
    },

    project: {
      list: async () => mapProjects(unwrapData(await request(config, "/api/project"))),
      // V2 has no single "current project" object; /api/location is the
      // location scope the server is serving this connection from.
      current: async () => {
        const raw = await request(config, "/api/location")
        return mapProjectFromLocation(raw)
      },
    },

    // Server-side filesystem browsing, scoped to this client's directory
    // (see ClientConfig.directory / x-opencode-directory header). Use
    // clientForDirectory(dir) to get a client rooted at a specific folder,
    // then list("." ) to enumerate its immediate children.
    file: {
      list: async (params: { path?: string } = {}) => {
        const query = new URLSearchParams({ path: params.path ?? "." })
        // GET /api/fs/list returns { location, data: Entry[] } directly — it is
        // NOT wrapped in { data: ... }, so unwrapData() would wrongly return
        // just the `data` array and drop `location` (BUG-001). Read the raw
        // envelope instead.
        const body = await request<{
          location?: { directory?: string }
          data?: unknown[]
        }>(config, `/api/fs/list?${query.toString()}`)
        const cwd = body?.location?.directory ?? config.directory ?? ""
        return mapFileEntries(body?.data, cwd)
      },
      // Enumerate the server's filesystem roots (mounted drives, home dir)
      // to seed the directory browser's pinned top-level entries. Resolves
      // to null on servers that don't yet expose GET /file/roots (older
      // opencode builds, and all V2 servers) so callers fall back to manual
      // path entry instead of crashing; other errors propagate like any
      // other request.
      roots: async (): Promise<FileRoot[] | null> => {
        try {
          return await request<FileRoot[]>(config, "/file/roots")
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) return null
          throw err
        }
      },
    },

    path: {
      get: async () => {
        // V1: { home, state, config, worktree, directory }. V2 /api/location
        // exposes the project root and active directory; fill the rest with
        // empty strings — the only consumer is connections.ts, which reads
        // `home` for ~ expansion.
        const raw = await request<{
          directory?: string
          project?: { directory?: string; canonical?: string }
        }>(config, "/api/location")
        const directory = raw?.directory ?? ""
        const worktree = raw?.project?.directory ?? raw?.project?.canonical ?? directory
        return {
          home: worktree,
          state: "",
          config: "",
          worktree,
          directory,
        }
      },
    },

    session: {
      get: (sessionID: string) => getSession(sessionID),

      list: listSessionsShaped,

      // Direct children of one session (the `subagent` tool's sessions). V2
      // filters server-side and, unlike the global list, keeps the requested
      // parent: paging that list client-side would need every session on the
      // server to find a handful of children.
      children: async (parentID: string): Promise<Session[]> => {
        const query = new URLSearchParams({ parentID, limit: "100" })
        const body = await request<{ data?: V2SessionInfo[]; cursor?: { next?: string | null } }>(
          config,
          `/api/session?${query.toString()}`,
        )
        const rows = Array.isArray(body?.data) ? body.data : []
        return rows.map((s) => mapSession(s, config.directory))
      },

      create: async (params?: { title?: string }) => {
        // V2 creates the session at the server's own cwd when `location` is
        // absent — it ignores x-opencode-directory for this route, so the
        // requested project has to travel in the body.
        const raw = unwrapData<V2SessionInfo>(
          await request(config, "/api/session", {
            method: "POST",
            body: JSON.stringify({
              ...(params || {}),
              ...(config.directory ? { location: { directory: config.directory } } : {}),
            }),
          }),
        )
        return mapSession(raw, config.directory)
      },

      delete: (sessionID: string) =>
        request<void>(config, `/api/session/${sessionID}`, { method: "DELETE" }),

      update: async (sessionID: string, params: { title?: string; time?: { archived?: number } }) => {
        // V2 PATCH accepts {title, metadata, permissions} — archiving isn't
        // supported, degrade to a title-only patch and return fresh info.
        if (!params.title) return getSession(sessionID)
        await request(config, `/api/session/${sessionID}`, {
          method: "PATCH",
          body: JSON.stringify({ title: params.title }),
        })
        return getSession(sessionID)
      },

      messages: async (sessionID: string, params?: { limit?: number }) => {
        const query = new URLSearchParams()
        const limit = clampMessageLimit(params?.limit)
        if (limit) query.set("limit", String(limit))
        const qs = query.toString()
        const raw = unwrapData<V2MessageBody[]>(
          await request(config, `/api/session/${sessionID}/message${qs ? `?${qs}` : ""}`),
        )
        return mapMessages(raw, sessionID)
      },

      /**
       * The whole transcript, for the "whole session" page size and for
       * load-older. `messages()` with no limit gets the server default, which
       * is 50 — the old "load all" path asked for that and then set
       * hasMore=false, so anything past the newest 50 messages was unreachable.
       */
      allMessages: async (sessionID: string): Promise<MessageWithParts[]> => {
        const out: V2MessageBody[] = []
        const seen = new Set<string>()
        let cursor: string | undefined
        for (let page = 0; page < 10; page++) {
          const query = new URLSearchParams({ limit: String(MAX_MESSAGE_LIMIT) })
          if (cursor) query.set("cursor", cursor)
          const body = await request<{ data?: V2MessageBody[]; cursor?: { previous?: string | null } }>(
            config,
            `/api/session/${sessionID}/message?${query.toString()}`,
          )
          const rows = Array.isArray(body?.data) ? body.data : []
          const fresh = rows.filter((row) => row?.id && !seen.has(row.id))
          for (const row of fresh) seen.add(row.id)
          out.push(...fresh)
          // The message cursor does not advance on every server build (it can
          // answer an empty page), so a page with no new rows ends the walk
          // rather than relying on the cursor alone.
          const previous = body?.cursor?.previous ?? undefined
          if (!previous || previous === cursor || fresh.length === 0) break
          cursor = previous
        }
        return mapMessages(out, sessionID)
      },

      // Which sessions this server is executing right now. Authoritative for
      // busy/idle: a session missing from the record is not running, even when
      // its transcript tail looks unfinished (the run died server-side).
      // GET /api/session/active → { data: { <sessionID>: { type: "running" } } }.
      active: async () => {
        const raw = unwrapData<Record<string, unknown>>(await request(config, "/api/session/active"))
        return Object.keys(raw ?? {})
      },

      // Sends a message and returns the response
      // Fire-and-forget async prompt - SSE events drive all real-time updates
      prompt: async (
        sessionID: string,
        params: {
          parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }>
          model?: { providerID: string; modelID: string }
          agent?: string
          variant?: string
        },
      ): Promise<void> => {
        // V2's prompt body has no model/agent fields — the active model and
        // agent are session-level switches. Only send them when the user
        // made an explicit choice (see the model-selection lessons in
        // .agents/retro.md: never auto-select for the server).
        // A re-sent switch for the same triple re-runs server-side switching,
        // which resets the session's reasoning variant (V2 logs "Switched
        // variant to default" when the body omits one) and churns the TUI
        // with switch notifications on every message. Skip identical repeats.
        const switchKey = `${sessionID}|${params.model ? params.model.providerID + "/" + params.model.modelID : ""}|${params.variant ?? ""}|${params.agent ?? ""}`
        if ((params.model || params.agent) && lastSwitch.get(sessionID) !== switchKey) {
          // Model and agent are independent session switches: send them at the
          // same time, or a tunnel with 200 ms RTT costs two extra round trips
          // before every prompt. Promise.all still fails the send if either
          // switch failed, so the model cannot silently remain wrong.
          const switches: Array<Promise<unknown>> = []
          if (params.model) {
            // Only send the switch when the user made an explicit choice (see
            // the model-selection lessons in .agents/retro.md: never
            // auto-select for the server). A variant without an explicit model
            // is dropped — the session's server-side default already carries
            // its own variant configuration and guessing one here would
            // override the server's choice.
            switches.push(
              request(config, `/api/session/${sessionID}/model`, {
                method: "POST",
                body: JSON.stringify({
                  model: {
                    providerID: params.model.providerID,
                    id: params.model.modelID,
                    ...(params.variant ? { variant: params.variant } : {}),
                  },
                }),
              }),
            )
          }
          if (params.agent) {
            switches.push(
              request(config, `/api/session/${sessionID}/agent`, {
                method: "POST",
                body: JSON.stringify({ agent: params.agent }),
              }),
            )
          }
          await Promise.all(switches)
        }

        const text = params.parts
          .filter((part) => part.type === "text")
          .map((part) => (part as { text: string }).text)
          .join("\n\n")
        const files = params.parts
          .filter((part) => part.type === "file")
          .map((part) => {
            const file = part as { mime: string; url: string; filename?: string }
            return { uri: file.url, name: file.filename }
          })

        const promptUrl = `${config.baseUrl}/api/session/${sessionID}/prompt`
        // No client-side timer (timeoutMs = 0): some V2 servers (2.0.24) hold
        // this POST open until the run finishes instead of returning right
        // away (2.0.32 answers in ~250ms). The old 30s REQUEST_TIMEOUT_MS
        // aborted the connection mid-run, the server cancelled the run when
        // the client disconnected (TUI: assistant box starts, never streams),
        // and the app's sending spinner stuck. SSE events drive the UI
        // regardless of when this POST resolves.
        const response = await fetchWithTimeout(promptUrl, {
          method: "POST",
          headers: createHeaders(config),
          body: JSON.stringify(files.length > 0 ? { text, files } : { text }),
        }, 0)
        if (!response.ok) {
          const error = await response.text()
          throw apiErrorFor(response.status, `Failed to send message: ${response.status} - ${error}`)
        }
        // BUG-021: only record the switch as done when the POST actually
        // succeeded — a failed switch must be retried on the next prompt.
        lastSwitch.set(sessionID, switchKey)
      },

      command: async (
        sessionID: string,
        params: {
          command: string
          arguments: string
          agent?: string
          model?: string
          variant?: string
          parts?: Array<{ type: "file"; mime: string; url: string; filename?: string }>
        },
      ): Promise<void> => {
        // V2: { name, text, files... }. The response body isn't consumed.
        // No client-side timer: long-running server commands (e.g. /compact)
        // must not be killed by the default 30s REQUEST_TIMEOUT_MS (BUG-002).
        const response = await fetchWithTimeout(
          `${config.baseUrl}/api/session/${sessionID}/command`,
          {
            method: "POST",
            headers: createHeaders(config),
            body: JSON.stringify({ name: params.command, text: params.arguments }),
          },
          0
        )

        if (!response.ok) {
          const error = await response.text()
          throw apiErrorFor(response.status, `Failed to run command: ${response.status} - ${error}`)
        }
      },

      abort: async (sessionID: string) => {
        const result = unwrapData<{ interrupted?: boolean }>(
          await request(config, `/api/session/${sessionID}/interrupt`, { method: "POST" }),
        )
        return Boolean(result?.interrupted ?? true)
      },

      // V2 exposes compaction as a dedicated endpoint (V1 had no SDK-level
      // compact; the TUI handled it client-side). The response carries the
      // summarization message id, which the UI doesn't need — SSE will
      // deliver the resulting messages.
      compact: async (sessionID: string) => {
        await request(config, `/api/session/${sessionID}/compact`, {
          method: "POST",
          body: JSON.stringify({}),
        })
        return true
      },

      diff: async (sessionID: string, messageID?: string) => {
        // V2 diff has from/to/context params — no per-message mode. The
        // messageID variant is unused by the UI today; call it through with
        // a tolerated mismatch (results are scoped to the whole session).
        void messageID
        const raw = unwrapData<unknown[]>(await request(config, `/api/session/${sessionID}/diff`))
        return raw ?? []
      },

      // Marks messageID (and everything after it) as pending revert. The
      // underlying messages aren't deleted until the next prompt runs
      // cleanup. V2 models this as revert/stage; the session's `revert`
      // field flips mirrors V1's session.revert so the UI filter keeps
      // working.
      revert: async (sessionID: string, messageID: string, partID?: string) => {
        void partID
        await request(config, `/api/session/${sessionID}/revert/stage`, {
          method: "POST",
          body: JSON.stringify({ messageID }),
        })
        return getSession(sessionID)
      },

      // Unrevert = clear the pending revert. V2 exposes this as DELETE on
      // the revert resource; the response carries no session, so refetch.
      unrevert: async (sessionID: string) => {
        await request(config, `/api/session/${sessionID}/revert`, { method: "DELETE" })
        return getSession(sessionID)
      },
    },

    permission: {
      list: async () => mapPermissions(unwrapData(await request(config, "/api/permission/request"))),

      reply: (sessionID: string, requestID: string, reply: "once" | "always" | "reject") =>
        request<void>(config, `/api/session/${sessionID}/permission/${requestID}/reply`, {
          method: "POST",
          body: JSON.stringify({ decision: reply }),
        }),
    },

    question: {
      // V2 has no dedicated question endpoints: model questions arrive as
      // session forms tagged metadata.kind === "question" (see mapForm in
      // v2-compat). Every form route is session-scoped, so callers pass the
      // session id next to the form id.
      list: async (sessionID: string) => {
        const raw = unwrapData<V2FormInfo[]>(await request(config, `/api/session/${sessionID}/form`))
        return mapForms(raw)
      },

      reply: async (sessionID: string, requestID: string, answers: string[][]) => {
        // The reply itself only knows labels; field types (string vs
        // multiselect) and option values live on the form detail.
        const detail = unwrapData<{ fields?: V2FormField[] }>(
          await request(config, `/api/session/${sessionID}/form/${requestID}`),
        )
        await request(config, `/api/session/${sessionID}/form/${requestID}/reply`, {
          method: "POST",
          body: JSON.stringify({ answer: buildFormAnswer(detail?.fields, answers) }),
        })
        return true
      },

      reject: async (sessionID: string, requestID: string) => {
        await request(config, `/api/session/${sessionID}/form/${requestID}`, { method: "DELETE" })
        return true
      },
    },

    agent: {
      list: async () => mapAgents(unwrapData(await request(config, "/api/agent"))),
    },

    command: {
      list: async () => mapCommands(unwrapData(await request(config, "/api/command"))),
    },

    provider: {
      list: async (): Promise<ProviderCatalog> => {
        const [raw, rawDefault] = await Promise.all([
          unwrapData(await request(config, "/api/model")),
          request(config, "/api/model/default")
            .then((body) => unwrapData(body))
            .catch(() => null),
        ])
        return mapProviders(raw, rawDefault)
      },
      /**
       * Store an API key for a provider on the remote opencode serve instance.
       * Tries V2 `/api/integration/.../connect/key`, then classic `/auth/:id`.
       * The key is sent over the existing authenticated connection and is not
       * retained by the client after the call returns.
       */
      connectApiKey: async (providerID: string, apiKey: string): Promise<{ path: string }> => {
        const attempts = connectKeyAttempts(providerID, apiKey)
        let lastError: unknown
        for (const attempt of attempts) {
          try {
            await request(config, attempt.path, {
              method: attempt.method,
              body: JSON.stringify(attempt.body),
            })
            return { path: attempt.path }
          } catch (error) {
            lastError = error
            if (error instanceof ApiError && shouldTryNextConnectEndpoint(error.status)) {
              continue
            }
            throw error
          }
        }
        throw lastError instanceof Error ? lastError : new ApiError(0, "Provider connect failed")
      },
    },

    config: {
      // V2 /api/config returns Config.Entry[] (array, possibly empty).
      get: () => request<unknown>(config, "/api/config"),
    },
  }
}

// A probe is a diagnostic, not a session call: it should answer in about a
// second on a LAN and give up before the onboarding flow's own timeout.
const PROBE_TIMEOUT_MS = 8_000

/** Probe a connection and report which server API it speaks (see api-detect.ts). */
export async function probeServer(config: ClientConfig): Promise<ServerIdentity> {
  const normalized: ClientConfig = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") }
  const headers = createHeaders(normalized)
  const probe: ProbeRequest = async (path) => {
    const response = await fetchWithTimeout(`${normalized.baseUrl}${path}`, { headers }, PROBE_TIMEOUT_MS)
    const contentType = response.headers.get("content-type") ?? ""
    const body = await response.text().catch(() => "")
    return { status: response.status, contentType, body }
  }
  return detectServerApi(probe)
}

export function createClient(config: ClientConfig): Client {
  if (config.api === "v1") {
    // Both clients implement the same runtime contract (session, project,
    // permission, question, provider, config). The cast covers the one place
    // their types differ nominally: v1's /question and /permission lists hand
    // back untyped records while the v2 mappers produce shaped requests, and
    // events.ts already treats both as records when reconciling.
    return createV1Client(config) as unknown as Client
  }
  return createV2Client(config)
}

export type Client = ReturnType<typeof createV2Client>

// Note: `permission.reply` changed signature in V2 (session- and request-
// scoped). Callers that only knew (requestID, reply) must now pass the
// sessionID first; see stores/events.ts + app/session/[id].tsx for the call
// sites that were updated alongside.
export { joinPath }
