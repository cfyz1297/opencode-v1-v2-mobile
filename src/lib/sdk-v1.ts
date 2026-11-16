// SDK client wrapper for React Native — opencode v1 server API (<= 1.18.x).
//
// The v1 and v2 APIs differ in routing prefix, list envelopes, SSE payload
// names and the question/permission endpoints. Rather than mixing fallbacks
// into one request path (where a missing route silently falls through to the
// web SPA), this module is a separate transport. sdk.ts probes the connection
// (api-detect.ts) and hands it here; the internal shapes this client returns
// are the same ones v2-compat.ts maps V2 responses into, so stores and screens
// are unchanged.
//
// expo/fetch provides WinterCG-compliant fetch with ReadableStream support for SSE
import { fetch as expoFetch } from "expo/fetch"
import { CONNECT_TIMEOUT_MS, dialStream, SSEParser } from "./sse"
import { ApiError, apiErrorFor } from "./api-error"
import { createHeaders, fetchWithTimeout, request } from "./http"
import { loadSessionList } from "./session-list"
import { MAX_MESSAGE_LIMIT } from "./message-page"
import type { Agent, ClientConfig, Command, Event, FileEntry, HealthResponse, MessageWithParts, Project, Session } from "./sdk"
import type { FileRoot } from "./file-roots"
import type { ProviderCatalog } from "./v2-compat"

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

// V1 permissions come in two payload generations: 1.18.x emits
// {id, sessionID, permission, patterns, metadata}, older builds emit
// {id, sessionID, type, title, metadata}. The app's prompt model is the former.
export function mapV1Permission(raw: unknown): {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  tool?: { messageID: string; callID: string }
} | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === "string" ? raw.id : ""
  const sessionID = typeof raw.sessionID === "string" ? raw.sessionID : ""
  if (!id || !sessionID) return null
  const rawPatterns = raw.patterns ?? raw.resources ?? (typeof raw.pattern === "string" ? [raw.pattern] : [])
  const patterns = Array.isArray(rawPatterns) ? rawPatterns.filter((p): p is string => typeof p === "string") : []
  const permission =
    (typeof raw.permission === "string" && raw.permission) ||
    (typeof raw.action === "string" && raw.action) ||
    (typeof raw.type === "string" && raw.type) ||
    (typeof raw.title === "string" && raw.title) ||
    "permission"
  const title = typeof raw.title === "string" && raw.title ? [raw.title] : []
  const tool = raw.tool as { messageID?: unknown; callID?: unknown } | undefined
  return {
    id,
    sessionID,
    permission,
    patterns: patterns.length > 0 ? patterns : title,
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
    tool:
      isRecord(tool) && typeof tool.messageID === "string"
        ? { messageID: tool.messageID, callID: typeof tool.callID === "string" ? tool.callID : "" }
        : undefined,
  }
}

/** Rewrite events whose names/shapes differ from what the stores consume. */
export function normalizeV1Event(event: Event): Event {
  if (event.type === "session.idle") {
    const sessionID = event.properties?.sessionID
    if (typeof sessionID === "string") {
      return { type: "session.status", properties: { sessionID, status: { type: "idle" } } }
    }
  }
  // 1.18.x servers emit the next-generation permission payload
  // ({action, resources}) under a `permission.v2.*` name. Only the old name is
  // handled by the stores, so a prompt that arrives this way is silently
  // dropped and the session waits forever for an approval nobody can give.
  if (event.type === "permission.v2.asked") {
    const mapped = mapV1Permission(event.properties)
    if (mapped) return { type: "permission.asked", properties: mapped }
  }
  if (event.type === "permission.v2.replied") {
    return { type: "permission.replied", properties: event.properties }
  }
  if (event.type === "permission.updated") {
    const mapped = mapV1Permission({ permission: undefined, ...event.properties })
    if (mapped) return { type: "permission.asked", properties: mapped }
  }
  return event
}

export function createV1Client(config: ClientConfig) {
  // Normalize once: a trailing slash would otherwise survive into every
  // `${config.baseUrl}${path}` concatenation as a double slash.
  config = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") }

  return {
    global: {
      health: async (timeoutMs?: number): Promise<HealthResponse> => {
        const info = await request<{ healthy?: boolean; version?: string }>(config, "/global/health", {}, timeoutMs)
        return { healthy: info?.healthy ?? true, version: info?.version ?? "unknown" }
      },
      // SSE event stream — V1 emits {type, properties} envelopes directly.
      async *events(signal?: AbortSignal, onActivity?: () => void): AsyncGenerator<Event> {
        const url = `${config.baseUrl}/global/event`
        const headers = createHeaders(config)
        delete headers["Content-Type"]
        headers["Accept-Encoding"] = "identity"

        const response = await dialStream(expoFetch, url, { headers, signal }, CONNECT_TIMEOUT_MS)
        if (!response.ok || !response.body) {
          throw apiErrorFor(response.status, `Failed to connect to event stream: ${response.status}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        const parser = new SSEParser()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            onActivity?.()
            for (const data of parser.push(decoder.decode(value, { stream: true }))) {
              try {
                yield normalizeV1Event(JSON.parse(data) as Event)
              } catch (err) {
                console.warn("[SSE] Failed to parse event", {
                  length: data.length,
                  error: err instanceof Error ? err.message : String(err),
                })
              }
            }
            // One macrotask per chunk keeps taps and navigation alive while a
            // buffered backlog drains after the app resumes from the background.
            await new Promise((resolve) => setTimeout(resolve, 0))
          }
        } finally {
          reader.releaseLock()
        }
      },
    },

    project: {
      list: () => request<Project[]>(config, "/project"),
      current: () => request<Project>(config, "/project/current"),
    },

    file: {
      list: async (params: { path?: string } = {}) => {
        const query = new URLSearchParams({ path: params.path ?? "." })
        const raw = await request<FileEntry[]>(config, `/file?${query.toString()}`)
        return Array.isArray(raw) ? raw : []
      },
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
      get: () =>
        request<{ home: string; state: string; config: string; worktree: string; directory: string }>(config, "/path"),
    },

    session: {
      // Global experimental list first (all directories); falls back to the
      // directory-scoped /session on 404 from older builds. The route defaults
      // to the newest 100 and silently truncates, so it is paged via its own
      // x-next-cursor header — otherwise every session past #100 by recency is
      // missing from the list even though the TUI still shows it.
      list: (params?: { roots?: boolean; limit?: number; search?: string }): Promise<Session[]> =>
        loadSessionList(
          {
            getExperimental: async (): Promise<Session[] | null> => {
              const all: Session[] = []
              const seen = new Set<string>()
              let cursor: number | undefined
              for (let page = 0; page < 10; page++) {
                const query = new URLSearchParams({ limit: "200" })
                if (cursor != null) query.set("cursor", String(cursor))
                const response = await fetchWithTimeout(
                  `${config.baseUrl}/experimental/session?${query.toString()}`,
                  { headers: createHeaders(config) },
                )
                if (response.status === 404) return page === 0 ? null : all
                if (!response.ok) {
                  const body = await response.text()
                  throw apiErrorFor(response.status, `API Error: ${response.status} - ${body}`)
                }
                const rows = (await response.json()) as Session[]
                if (!Array.isArray(rows) || rows.length === 0) break
                // Cursor boundaries can repeat rows on time.updated ties.
                for (const session of rows) if (!seen.has(session.id)) {
                  seen.add(session.id)
                  all.push(session)
                }
                const raw = response.headers.get("x-next-cursor")
                const next = raw == null ? undefined : Number(raw)
                // No cursor, a repeated one, or a malformed one ends the walk —
                // a server that ignores the parameter must not loop forever.
                if (next == null || !Number.isFinite(next) || next === cursor) break
                cursor = next
              }
              return all
            },
            getLegacy: (query) => request<Session[]>(config, `/session${query}`),
          },
          params,
        ),

      get: (sessionID: string) => request<Session>(config, `/session/${sessionID}`),

      create: (params?: { title?: string }) =>
        request<Session>(config, "/session", {
          method: "POST",
          body: JSON.stringify(params || {}),
        }),

      delete: (sessionID: string) => request<void>(config, `/session/${sessionID}`, { method: "DELETE" }),

      update: (sessionID: string, params: { title?: string; time?: { archived?: number } }) =>
        request<Session>(config, `/session/${sessionID}`, {
          method: "PATCH",
          body: JSON.stringify(params),
        }),

      messages: (sessionID: string, params?: { limit?: number }) => {
        const query = new URLSearchParams()
        if (params?.limit) query.set("limit", String(params.limit))
        const qs = query.toString()
        return request<MessageWithParts[]>(config, `/session/${sessionID}/message${qs ? `?${qs}` : ""}`)
      },

      // v1 returns the transcript in one response (no message cursor), so the
      // whole session is simply the largest page the route accepts.
      allMessages: (sessionID: string) =>
        request<MessageWithParts[]>(config, `/session/${sessionID}/message?limit=${MAX_MESSAGE_LIMIT}`),

      // The v1 API has no activity record. Throwing is the contract: callers
      // treat a missing answer as "fall back to the transcript heuristic".
      active: async (): Promise<string[]> => {
        throw new ApiError(404, "Session activity is not exposed by the v1 API")
      },

      prompt: async (
        sessionID: string,
        params: {
          parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }>
          model?: { providerID: string; modelID: string }
          agent?: string
          variant?: string
        },
      ): Promise<void> => {
        // V1 carries model/agent in the prompt body; there are no per-session
        // switch endpoints. No timer: the turn runs server-side.
        const response = await fetchWithTimeout(
          `${config.baseUrl}/session/${sessionID}/prompt_async`,
          {
            method: "POST",
            headers: createHeaders(config),
            body: JSON.stringify(params),
          },
          0,
        )
        if (!response.ok) {
          const error = await response.text()
          throw apiErrorFor(response.status, `Failed to send message: ${response.status} - ${error}`)
        }
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
        const response = await fetchWithTimeout(
          `${config.baseUrl}/session/${sessionID}/command`,
          {
            method: "POST",
            headers: createHeaders(config),
            body: JSON.stringify({ ...params, sessionID }),
          },
          0,
        )
        if (!response.ok) {
          const error = await response.text()
          throw apiErrorFor(response.status, `Failed to run command: ${response.status} - ${error}`)
        }
      },

      abort: (sessionID: string) => request<boolean>(config, `/session/${sessionID}/abort`, { method: "POST" }),

      // V1 exposes summarization through the summarize route. Some builds want
      // the current model in the body; the server's active model is used when
      // it is omitted. shortcut: per-model summarize payload, add when a v1
      // server rejects the empty body.
      compact: async (sessionID: string) => {
        await request(config, `/session/${sessionID}/summarize`, { method: "POST", body: JSON.stringify({}) })
        return true
      },

      diff: (sessionID: string, messageID?: string) => {
        const qs = messageID ? `?messageID=${encodeURIComponent(messageID)}` : ""
        return request<unknown[]>(config, `/session/${sessionID}/diff${qs}`)
      },

      revert: (sessionID: string, messageID: string, partID?: string) =>
        request<Session>(config, `/session/${sessionID}/revert`, {
          method: "POST",
          body: JSON.stringify(partID ? { messageID, partID } : { messageID }),
        }),

      unrevert: (sessionID: string) =>
        request<Session>(config, `/session/${sessionID}/unrevert`, { method: "POST" }),
    },

    permission: {
      list: async () => {
        const raw = await request<unknown[]>(config, "/permission")
        return (Array.isArray(raw) ? raw : []).map(mapV1Permission).filter((p) => p !== null)
      },

      // V1 scopes the reply by request id only; the sessionID stays in the
      // signature so call sites never branch on the transport.
      reply: (_sessionID: string, requestID: string, reply: "once" | "always" | "reject") =>
        request<boolean>(config, `/permission/${requestID}/reply`, {
          method: "POST",
          body: JSON.stringify({ reply }),
        }),
    },

    question: {
      list: async (sessionID: string) => {
        const raw = await request<unknown[]>(config, "/question")
        return (Array.isArray(raw) ? raw : []).filter(
          (q) => isRecord(q) && (q.sessionID === undefined || q.sessionID === sessionID),
        )
      },

      reply: (sessionID: string, requestID: string, answers: string[][]) => {
        void sessionID
        return request<boolean>(config, `/question/${requestID}/reply`, {
          method: "POST",
          body: JSON.stringify({ answers }),
        })
      },

      reject: (sessionID: string, requestID: string) => {
        void sessionID
        return request<boolean>(config, `/question/${requestID}/reject`, { method: "POST" })
      },
    },

    agent: {
      list: () => request<Agent[]>(config, "/agent"),
    },

    command: {
      list: () => request<Command[]>(config, "/command"),
    },

    provider: {
      list: () => request<ProviderCatalog>(config, "/provider"),
      /**
       * Store an API key for a provider on the remote opencode serve instance.
       * The v1 API has one route for this; the v2 integration routes would fall
       * through to the web SPA (HTML 200) instead of answering.
       */
      connectApiKey: async (providerID: string, apiKey: string): Promise<{ path: string }> => {
        const path = `/auth/${encodeURIComponent(providerID)}`
        await request(config, path, {
          method: "PUT",
          body: JSON.stringify({ type: "api", key: apiKey }),
        })
        return { path }
      },
    },

    config: {
      get: () => request<unknown>(config, "/config"),
    },
  }
}

export type V1Client = ReturnType<typeof createV1Client>
