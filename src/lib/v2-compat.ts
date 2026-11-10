// OpenCode V2 HTTP API compatibility layer.
//
// opencode V2 replaced the V1 REST surface (/global/health, /session, ...) with
// a location-scoped /api/* surface and a different event stream. This module
// holds all the V2 → V1 shape mapping so sdk.ts can keep exposing the V1-style
// client the rest of the app (stores, screens) was built against — see
// AGENTS.md "additive adapter" guidance: nothing upstream changed except the
// transport layer below.
//
// Everything here is pure (no RN imports, no sockets) so it's unit-testable
// with node --test, same pattern as api-error.ts / session-list.ts.
import type {
  Agent,
  Command,
  Event,
  FileEntry,
  Message,
  MessageWithParts,
  Part,
  Project,
  Session,
} from "./sdk"

// --- Loose V2 payload types -------------------------------------------------
// Hand-shaped from the live V2 OpenAPI spec (GET /openapi.json) rather than
// generated, so only the fields we consume are declared.

export interface V2SessionInfo {
  id: string
  title?: string
  parentID?: string
  projectID?: string
  /** Cumulative for the whole session. */
  cost?: number
  tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
  location?: { directory?: string }
  time?: { created?: number; updated?: number; archived?: number }
  revert?: { messageID: string; partID?: string }
}

export interface V2MessageBody {
  id: string
  type: string
  time?: { created?: number; completed?: number }
  text?: string
  files?: unknown[]
  agent?: string
  model?: { id?: string; providerID?: string }
  content?: V2ContentItem[]
  finish?: string
  cost?: number
  tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
  error?: { type?: string; message?: string }
  // Compaction messages (type: "compaction") carry the summary the same way
  // the TUI shows it, plus a status and the reason it was triggered.
  status?: string
  reason?: string
  summary?: string
}

export interface V2ContentItem {
  type: string
  text?: string
  // tool content
  id?: string
  name?: string
  state?: {
    status?: string
    input?: unknown
    content?: Array<{ type?: string; text?: string }>
    error?: { message?: string; type?: string }
    metadata?: Record<string, unknown> & { title?: string }
  }
}

export interface V2EventEnvelope {
  id?: string
  created?: number
  type: string
  location?: { directory?: string }
  data?: Record<string, unknown>
}

// --- Generic helpers ---------------------------------------------------------

// V2 wraps single-resource responses and collection endpoints in
// `{ data: ... }` (often plus `location` / `cursor`). V1 never wrapped.
export function unwrapData<T>(body: unknown): T {
  if (body !== null && typeof body === "object" && "data" in (body as Record<string, unknown>)) {
    const record = body as Record<string, unknown>
    if (record.data === null || record.data === undefined) return [] as unknown as T
    return record.data as T
  }
  return body as T
}

// V2 message paging validates limit <= 200 server-side (400 otherwise).
export function clampMessageLimit(limit?: number): number | undefined {
  if (limit == null) return undefined
  return Math.max(1, Math.min(Math.floor(limit), 200))
}

// --- Sessions ----------------------------------------------------------------

export function mapSession(raw: V2SessionInfo | null | undefined, fallbackDirectory = ""): Session {
  const source = raw ?? ({} as V2SessionInfo)
  return {
    id: source.id ?? "",
    slug: (source as { slug?: string }).slug ?? "",
    projectID: source.projectID ?? "",
    // V2 has no per-session directory column; the closest truth is the
    // location ref the server stamps on each session (falls back to the
    // directory the request was scoped to, else empty string).
    directory: source.location?.directory ?? fallbackDirectory,
    parentID: source.parentID,
    title: source.title ?? "",
    version: "2",
    cost: source.cost,
    tokens: source.tokens
      ? {
          input: source.tokens.input ?? 0,
          output: source.tokens.output ?? 0,
          reasoning: source.tokens.reasoning ?? 0,
          cache: { read: source.tokens.cache?.read ?? 0, write: source.tokens.cache?.write ?? 0 },
        }
      : undefined,
    time: {
      created: source.time?.created ?? 0,
      updated: source.time?.updated ?? source.time?.created ?? 0,
      archived: source.time?.archived,
    },
    revert:
      source.revert?.messageID != null
        ? { messageID: source.revert.messageID, partID: source.revert?.partID }
        : undefined,
  }
}

// V2 GET /api/session{id}/message returns a page in NEWEST-FIRST order (the
// oldest message is last — verified against a live session). The app renders
// oldest → newest, so reverse.
export function mapMessages(raw: unknown, sessionID: string): MessageWithParts[] {
  const list = Array.isArray(raw) ? raw : []
  const filtered = (list as V2MessageBody[]).filter(
    (m) => m.type === "user" || m.type === "assistant" || m.type === "compaction",
  )
  return filtered
    .slice()
    .reverse() // newest-first from the server → oldest-first for the UI
    .map((m) => mapMessage(m, sessionID))
}

function mapMessage(m: V2MessageBody, sessionID: string): MessageWithParts {
  const sid = sessionID
  const created = m.time?.created ?? 0
  if (m.type === "user") {
    const info: Message = {
      id: m.id,
      sessionID: sid,
      role: "user",
      time: { created },
      agent: (m as { metadata?: { agent?: string } }).metadata?.agent,
      model: (m as { metadata?: { model?: { providerID: string; modelID: string } } }).metadata?.model,
    }
    return { info, parts: userParts(m, sid) }
  }

  // V2 keeps compaction as a conversation-level message (visible in the TUI
  // as the summary block). Without this branch the summary is silently
  // dropped from the app while the TUI still shows it.
  if (m.type === "compaction") {
    const info: Message = {
      id: m.id,
      sessionID: sid,
      role: "system",
      time: { created, completed: created },
    }
    const failed = m.status === "failed"
    const text = failed ? m.error?.message ?? m.error?.type ?? "" : m.summary ?? ""
    return {
      info,
      parts: [
        {
          id: `${m.id}_0`,
          sessionID: sid,
          messageID: m.id,
          type: "compaction",
          text,
          status: m.status,
          reason: m.reason,
        },
      ],
    }
  }

  const info: Message = {
    id: m.id,
    sessionID: sid,
    role: "assistant",
    time: { created, completed: m.time?.completed },
    agent: m.agent,
    modelID: m.model?.id,
    providerID: m.model?.providerID,
    cost: m.cost,
    tokens:
      m.tokens != null
        ? {
            input: m.tokens.input ?? 0,
            output: m.tokens.output ?? 0,
            reasoning: m.tokens.reasoning,
            cache: {
              read: m.tokens.cache?.read ?? 0,
              write: m.tokens.cache?.write ?? 0,
            },
          }
        : undefined,
    error: m.error ? { message: m.error.message ?? m.error.type ?? "error" } : undefined,
    finish: m.finish,
  }
  return { info, parts: assistantParts(m, sid) }
}

function userParts(m: V2MessageBody, sid: string): Part[] {
  const parts: Part[] = [{ id: `${m.id}_0`, sessionID: sid, messageID: m.id, type: "text", text: m.text ?? "" }]
  const files = Array.isArray(m.files) ? m.files : []
  for (const [i, raw] of files.entries()) {
    const file = raw as {
      name?: string
      mime?: string
      // V2 stores the payload as a bare base64 string (Prompt.Base64).
      // Keep the object form for older payloads captured during the port.
      data?: string | { base64?: string }
      source?: { type?: string; uri?: string; path?: string }
    }
    const base64 = typeof file.data === "string" ? file.data : file.data?.base64
    // V2's `source` is provenance only - its file:// URI points at the
    // server's filesystem, not at anything the phone can load. Inline data is
    // the only renderable source (and the only one that can be resent after
    // revert); an empty URI would render as a white image box.
    const url = base64 ? `data:${file.mime ?? "image/jpeg"};base64,${base64}` : ""
    if (!url) continue
    parts.push({
      id: `${m.id}_f${i}`,
      sessionID: sid,
      messageID: m.id,
      type: "file",
      mime: file.mime,
      url,
      filename: file.name,
    })
  }
  return parts
}

function assistantParts(m: V2MessageBody, sid: string): Part[] {
  const content = Array.isArray(m.content) ? m.content : []
  const parts: Part[] = []
  for (const [i, item] of content.entries()) {
    const id = `${m.id}_${i}`
    const base = { id, sessionID: sid, messageID: m.id }
    if (item.type === "text") {
      parts.push({ ...base, type: "text", text: item.text ?? "" })
    } else if (item.type === "reasoning") {
      parts.push({ ...base, type: "reasoning", text: item.text ?? "" })
    } else if (item.type === "tool") {
      const state = item.state ?? {}
      const output = contentText(state.content)
      parts.push({
        ...base,
        type: "tool",
        tool: item.name ?? "",
        callID: item.id,
        state: {
          status: mapToolStatus(state.status),
          input: state.input,
          output,
          title: state.metadata?.title,
          error: state.error
            ? { message: state.error.message ?? state.error.type ?? "error" }
            : undefined,
        },
      })
    }
  }
  return parts
}

// V2 tool state adds "streaming" (input still arriving); V1's enum is
// pending | running | completed | error.
function mapToolStatus(status?: string): "pending" | "running" | "completed" | "error" {
  if (status === "streaming") return "pending"
  if (status === "running") return "running"
  if (status === "completed") return "completed"
  if (status === "error") return "error"
  return "pending"
}

function contentText(content?: Array<{ type?: string; text?: string }>): string {
  const list = Array.isArray(content) ? content : []
  return list
    .filter((c) => typeof c?.text === "string")
    .map((c) => c.text as string)
    .join("\n")
}

// --- Agent / command / provider catalogs --------------------------------------

export function mapAgents(raw: unknown): Agent[] {
  const list = Array.isArray(raw) ? raw : []
  return (list as Record<string, unknown>[]).map((a) => {
    const model = a.model as { id?: string; providerID?: string } | undefined
    return {
      id: (a.id as string) ?? (a.name as string) ?? "",
      name: (a.name as string) ?? (a.id as string) ?? "",
      description: a.description as string | undefined,
      mode: ((a.mode as string) ?? "primary") as Agent["mode"],
      hidden: Boolean(a.hidden),
      native: true,
      color: a.color as string | undefined,
      model: model?.id && model?.providerID ? { modelID: model.id, providerID: model.providerID } : undefined,
      options: {},
    }
  })
}

export function mapCommands(raw: unknown): Command[] {
  const list = Array.isArray(raw) ? raw : []
  return (list as Record<string, unknown>[]).map((c) => ({
    name: (c.name as string) ?? "",
    description: c.description as string | undefined,
    // V2 dropped command templates; the UI passes name + arguments to
    // POST /api/session/{id}/command instead.
    template: "",
    hints: [],
  }))
}

export interface ProviderCatalog {
  all: Array<{
    id: string
    name: string
    models: Record<
      string,
      {
        id: string
        name: string
        attachment: boolean
        reasoning: boolean
        tool_call: boolean
        cost?: { input: number; output: number; cache?: { read: number; write: number } }
        limit: { context: number; output: number }
        status?: "alpha" | "beta" | "deprecated" | "active"
        variants?: Record<string, { reasoningEffort?: string }>
      }
    >
  }>
  default: Record<string, string>
  connected: string[]
}

// GET /api/model → { data: Model.Info[] }; GET /api/model/default → { data: Model.Info | null }.
// V1's /provider returned { all, default, connected } where `default` is a
// Record<providerID, modelID>.
export function mapProviders(list: unknown, defaultModel: unknown): ProviderCatalog {
  const models = Array.isArray(list) ? (list as Record<string, unknown>[]) : []
  const grouped = new Map<string, ProviderCatalog["all"][number]>()
  for (const m of models) {
    // `id` is the catalog ID every other V2 surface names the model by
    // (Model.Ref in sessions/messages and POST /session/{id}/model), while
    // `modelID` is only the upstream API identifier. Keying the catalog by
    // modelID made the switch POST an unknown id and hid the reasoning
    // variants of the session's model (both reported as "model selection
    // stopped working").
    const providerID = (m.providerID as string) ?? ""
    const modelID = (m.id as string) ?? (m.modelID as string) ?? ""
    if (!providerID || !modelID) continue
    // The registry lists models the location cannot use; picking one would
    // fail the switch server-side.
    if (m.enabled === false) continue
    let provider = grouped.get(providerID)
    if (!provider) {
      provider = { id: providerID, name: providerID, models: {} }
      grouped.set(providerID, provider)
    }
    const caps = m.capabilities as { tools?: boolean; input?: string[] } | undefined
    const cost = aFirst(
      m.cost as Array<{ input?: number; output?: number; cache?: { read?: number; write?: number } }>,
    )
    const limit = m.limit as { context?: number; output?: number } | undefined
    const variants = Array.isArray(m.variants) ? m.variants : []
    provider.models[modelID] = {
      id: modelID,
      name: (m.name as string) ?? modelID,
      attachment: Boolean(caps?.input?.includes("image")),
      reasoning: variants.length > 0,
      tool_call: Boolean(caps?.tools),
      cost:
        cost != null
          ? {
              input: cost.input ?? 0,
              output: cost.output ?? 0,
              cache: { read: cost.cache?.read ?? 0, write: cost.cache?.write ?? 0 },
            }
          : undefined,
      limit: { context: limit?.context ?? 0, output: limit?.output ?? 0 },
      status: (m.status as never) ?? undefined,
      variants: Object.fromEntries(
        variants.map((v: { id?: string; settings?: { reasoningEffort?: string } }) => [
          v.id ?? "",
          { reasoningEffort: v.settings?.reasoningEffort },
        ]),
      ),
    }
  }

  const defaults: Record<string, string> = {}
  const def = defaultModel as { providerID?: string; modelID?: string; id?: string } | null | undefined
  if (def?.providerID) defaults[def.providerID] = def.id ?? def.modelID ?? ""

  return {
    all: [...grouped.values()],
    default: defaults,
    // V2 has no per-provider auth registry in the model list — every returned
    // provider is used by this server, treat it as connected.
    connected: [...grouped.keys()],
  }
}

function aFirst<T>(list?: T[]): T | undefined {
  return Array.isArray(list) && list.length > 0 ? list[0] : undefined
}

// --- Project / location -------------------------------------------------------

// GET /api/location → Location.PublicInfo; stand-in for V1's /project/current.
export function mapProjectFromLocation(raw: unknown): Project | null {
  const location = raw as {
    directory?: string
    project?: { id?: string; directory?: string; canonical?: string }
  } | null
  const project = location?.project
  if (!project?.id) return null
  const dir = project.directory ?? location?.directory ?? ""
  return {
    id: project.id,
    name: project.canonical?.split("/").pop(),
    path: { cwd: dir, root: dir, absolute: project.canonical ?? dir },
  }
}

export function mapProjects(raw: unknown): Project[] {
  const list = Array.isArray(raw) ? raw : []
  return (list as Record<string, unknown>[]).map((p) => {
    const dir = (p.canonical as string) ?? ""
    return {
      id: (p.id as string) ?? "",
      name: (p.name as string) ?? undefined,
      path: { cwd: dir, root: dir, absolute: dir },
    }
  })
}

// GET /api/fs/list → { location, data: FileSystem.Entry[] }.
// Entry paths are relative to the location directory (e.g. ".cache/"), so the
// FileEntry.absolute the directory browser navigates with must join them.
export function mapFileEntries(raw: unknown, cwd: string): FileEntry[] {
  const list = Array.isArray(raw) ? raw : []
  return (list as { path?: string; type?: string }[]).map((entry) => {
    const path = entry.path ?? ""
    const clean = path.replace(/\/+$/, "")
    const name = clean.split("/").pop() ?? clean
    return {
      name,
      path: clean,
      absolute: joinPath(cwd, clean),
      type: entry.type === "file" ? "file" : "directory",
      ignored: false,
    }
  })
}

export function joinPath(base: string, tail: string): string {
  if (!base) return tail
  if (!tail || tail === ".") return base
  return `${base.replace(/\/+$/, "")}/${tail}`
}

// --- Questions (V2 forms) -----------------------------------------------------
//
// V1 had a dedicated question REST surface and `question.asked` events. V2
// replaced both with the Form service: the question tool opens a form whose
// metadata.kind is "question". Fields are q0, q1, … with type "string" (single
// choice) or "multiselect"; option.value === option.label for tool-generated
// questions, and custom answers are allowed. Forms with any other metadata kind
// (web search provider, credentials, MCP elicitation) are not questions and
// must not reach the question UI.

export interface V2FormOption {
  value?: string
  label?: string
  description?: string
}

export interface V2FormField {
  key?: string
  type?: string
  title?: string
  description?: string
  options?: V2FormOption[]
  custom?: boolean
}

export interface V2FormInfo {
  id?: string
  sessionID?: string
  metadata?: Record<string, unknown>
  fields?: V2FormField[]
}

export type QuestionRequest = {
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
}

function questionFields(form: V2FormInfo): V2FormField[] {
  return (form.fields ?? []).filter((field) => field.type === "string" || field.type === "multiselect")
}

export function mapForm(raw: unknown): QuestionRequest | null {
  const form = raw as V2FormInfo | null | undefined
  if (!form || typeof form !== "object" || !form.id || !form.sessionID) return null
  if (form.metadata?.kind !== "question") return null
  const fields = questionFields(form)
  if (!fields.length) return null
  const tool = form.metadata.tool as { messageID?: string; id?: string } | undefined
  return {
    id: form.id,
    sessionID: form.sessionID,
    questions: fields.map((field) => ({
      question: field.description ?? field.title ?? "",
      header: field.title ?? "",
      options: (field.options ?? []).map((option) => ({
        label: option.label ?? option.value ?? "",
        description: option.description ?? "",
      })),
      multiple: field.type === "multiselect",
      custom: field.custom === true,
    })),
    tool: tool?.messageID ? { messageID: tool.messageID, callID: tool.id ?? "" } : undefined,
  }
}

export function mapForms(raw: unknown): QuestionRequest[] {
  const list = Array.isArray(raw) ? (raw as unknown[]) : []
  return list
    .map((item) => mapForm(item))
    .filter((request): request is QuestionRequest => request !== null)
}

// The question UI works in displayed labels and string[][] answers (one entry
// per question). Forms accept option values and distinguish scalar (string)
// from array (multiselect) answers, so translate back before replying.
export function buildFormAnswer(
  raw: unknown,
  answers: string[][] | undefined,
): Record<string, string | string[]> {
  const fields = (Array.isArray(raw) ? (raw as V2FormField[]) : []).filter(
    (field) => field.type === "string" || field.type === "multiselect",
  )
  const count = Math.max(fields.length, answers?.length ?? 0)
  const answer: Record<string, string | string[]> = {}
  for (let index = 0; index < count; index++) {
    const picked = (answers?.[index] ?? []).filter(
      (value) => typeof value === "string" && value.trim().length > 0,
    )
    if (!picked.length) continue
    const field = fields[index]
    const key = field?.key ?? `q${index}`
    const valueOf = (label: string) =>
      field?.options?.find((option) => option.label === label || option.value === label)?.value ?? label
    if (field?.type === "multiselect") answer[key] = picked.map(valueOf)
    else if (field) answer[key] = valueOf(picked[0])
    else answer[key] = picked.length > 1 ? picked : picked[0]
  }
  return answer
}

// --- Events -------------------------------------------------------------------
//
// The app stores dispatch on V1 event names/shapes. V2 renames most types and
// drops message-level events entirely (streaming is session-level deltas), so
// adaptV2Event rewrites each V2 envelope into zero or more V1 events.

export type V1Event = Event

// Internal per-message state so delta events can be merged into parts, and
// message.updated only fires once per assistant message.
interface AssistantState {
  sessionID: string
  id: string
  agent?: string
  modelID?: string
  providerID?: string
  created: number
  tokens?: { input: number; output: number; reasoning?: number; cache?: { read: number; write: number } }
  cost?: number
  finish?: string
  completed?: number
}

const MAX_TRACKED = 400

export class V2EventAdapter {
  private assistants = new Map<string, AssistantState>()
  private textAccum = new Map<string, string>()
  private reasoningAccum = new Map<string, string>()
  private seenMessageIDs = new Set<string>()
  private toolInputs = new Map<string, unknown>()
  private toolTimes = new Map<string, { start: number; end?: number }>()

  // Feed one decoded V2 event envelope. Returns the V1 events to dispatch.
  adapt(event: V2EventEnvelope): V1Event[] {
    const data = event.data ?? {}
    switch (event.type) {
      case "session.execution.started": {
        return [{ type: "session.status", properties: { sessionID: data.sessionID, status: { type: "busy" } } }]
      }

      case "session.execution.succeeded":
      case "session.execution.interrupted": {
        return [
          { type: "session.status", properties: { sessionID: data.sessionID, status: { type: "idle" } } },
        ]
      }

      case "session.execution.failed": {
        // A failed run is NOT a successful completion: surface a v1
        // session.error so the store marks erroredSessions, shows an error
        // banner on the active session, and does not count it toward the
        // store-review prompt (BUG-003).
        return [
          {
            type: "session.error",
            properties: {
              sessionID: data.sessionID,
              error: { message: (data.error as { message?: string })?.message || "Session failed" },
            },
          },
        ]
      }

      // Each step (model roundtrip) owns one assistant message: started
      // carries agent/model, ended carries the final tokens/cost/finish for
      // that message.
      case "session.step.started": {
        return this.ensureMessage(data, event)
      }

      case "session.step.ended": {
        const registered = this.ensureMessage(data, event)
        const patched = this.patchStepEnded(data, event)
        return patched ? [...registered, patched] : registered
      }

      case "session.text.started":
      case "session.reasoning.started": {
        // BUG-033: clear accum for this key so a repeated started event
        // (server replay/rollback) doesn't append stale text to the new run.
        const key = `${data.assistantMessageID}|${data.ordinal ?? 0}`
        if (event.type === "session.text.started") this.textAccum.delete(key)
        else this.reasoningAccum.delete(key)
        const events: V1Event[] = this.ensureMessage(data, event)
        events.push({
          type: "message.part.updated",
          properties: { part: this.rendererPart(data, event.type === "session.text.started" ? "text" : "reasoning", "") },
        })
        return events
      }

      case "session.text.delta": {
        this.ensureMessage(data, event)
        const key = `${data.assistantMessageID}|${data.ordinal ?? 0}`
        const accumulated = (this.textAccum.get(key) ?? "") + String(data.delta ?? "")
        this.textAccum.set(key, accumulated)
        this.prune()
        return [this.partUpdated(data, "text", accumulated)]
      }

      case "session.text.ended": {
        this.ensureMessage(data, event)
        return [this.partUpdated(data, "text", String(data.text ?? data.delta ?? ""))]
      }

      case "session.reasoning.delta": {
        this.ensureMessage(data, event)
        const key = `${data.assistantMessageID}|${data.ordinal ?? 0}`
        const accumulated = (this.reasoningAccum.get(key) ?? "") + String(data.delta ?? "")
        this.reasoningAccum.set(key, accumulated)
        this.prune()
        return [this.partUpdated(data, "reasoning", accumulated)]
      }

      case "session.reasoning.ended": {
        this.ensureMessage(data, event)
        return [this.partUpdated(data, "reasoning", String(data.text ?? data.delta ?? ""))]
      }

      case "session.tool.input.started": {
        const events: V1Event[] = this.ensureMessage(data, event)
        this.toolInputs.set(String(data.id), {})
        events.push(this.toolPartUpdated(data, { status: "pending", input: {} }, event.created))
        return events
      }

      // input.ended carries the full tool input as a JSON string; called /
      // progress / success re-use it when later events omit input.
      case "session.tool.input.ended": {
        const events: V1Event[] = this.ensureMessage(data, event)
        const input = parseMaybeJson(String(data.text ?? "{}"))
        this.toolInputs.set(String(data.id), input)
        events.push(this.toolPartUpdated(data, { status: "pending", input }, event.created))
        return events
      }

      case "session.tool.called": {
        const events: V1Event[] = this.ensureMessage(data, event)
        if (data.input !== undefined) this.toolInputs.set(String(data.id), data.input)
        events.push(
          this.toolPartUpdated(
            data,
            { status: "running", input: data.input ?? this.toolInputs.get(String(data.id)) },
            event.created,
          ),
        )
        return events
      }

      case "session.tool.progress": {
        const events: V1Event[] = this.ensureMessage(data, event)
        events.push(
          this.toolPartUpdated(
            data,
            {
              status: "running",
              input: this.toolInputs.get(String(data.id)),
              title: (data.metadata as { title?: string } | undefined)?.title,
            },
            event.created,
          ),
        )
        return events
      }

      case "session.tool.success": {
        const events: V1Event[] = this.ensureMessage(data, event)
        events.push(
          this.toolPartUpdated(
            data,
            {
              status: "completed",
              input: this.toolInputs.get(String(data.id)),
              output: contentText(data.content as Array<{ type?: string; text?: string }>),
            },
            event.created,
          ),
        )
        return events
      }

      case "session.tool.failed": {
        const events: V1Event[] = this.ensureMessage(data, event)
        const err = data.error as { message?: string } | undefined
        events.push(
          this.toolPartUpdated(
            data,
            {
              status: "error",
              input: this.toolInputs.get(String(data.id)),
              error: { message: err?.message ?? "Tool failed" },
            },
            event.created,
          ),
        )
        return events
      }

      // Permission lifecycle happens to share V1 names; only the payload
      // field names differ (action/resources/source instead of
      // permission/patterns/tool{messageID,callID}).
      case "permission.asked": {
        const source = data.source as { messageID?: string; id?: string } | undefined
        return [
          {
            type: "permission.asked",
            properties: {
              id: data.id,
              sessionID: data.sessionID,
              permission: data.action,
              patterns: data.resources ?? [],
              metadata: (data.metadata as Record<string, unknown>) ?? {},
              tool: source?.messageID ? { messageID: source.messageID, callID: source.id } : undefined,
            },
          },
        ]
      }

      case "permission.replied": {
        // { sessionID, requestID, reply } - exactly the V1 shape already.
        return [{ type: "permission.replied", properties: data }]
      }

      // BUG-004: V2 surfaces model questions as forms. Only forms tagged as
      // question prompts map to the question UI; other forms are ignored.
      case "form.created": {
        const request = mapForm(data.form)
        if (!request) return []
        return [{ type: "question.asked", properties: { ...request } }]
      }

      case "form.replied": {
        if (!data.sessionID || !data.id) return []
        return [
          {
            type: "question.replied",
            properties: {
              sessionID: data.sessionID,
              requestID: data.id,
              answers: data.answer ?? {},
            },
          },
        ]
      }

      case "form.cancelled": {
        if (!data.sessionID || !data.id) return []
        return [
          {
            type: "question.rejected",
            properties: { sessionID: data.sessionID, requestID: data.id },
          },
        ]
      }

      default:
        return []
    }
  }

  private ensureMessage(data: Record<string, unknown>, event: V2EventEnvelope): V1Event[] {
    const messageID = String(data.assistantMessageID ?? "")
    if (!messageID) return []
    let state = this.assistants.get(messageID)
    if (!state) {
      const model = data.model as { id?: string; providerID?: string } | undefined
      state = {
        sessionID: String(data.sessionID ?? ""),
        id: messageID,
        agent: (data.agent as string) ?? undefined,
        modelID: model?.id,
        providerID: model?.providerID,
        created: event.created ?? Date.now(),
      }
      this.assistants.set(messageID, state)
      this.prune()
    }
    // message.updated exactly once per assistant message — the merge logic
    // in message-merge.ts replaces an existing id in place, so re-sending
    // the bare info would clobber richer updates from later steps.
    if (this.seenMessageIDs.has(messageID)) return []
    this.seenMessageIDs.add(messageID)
    return [{ type: "message.updated", properties: { info: this.messageInfo(state) } }]
  }

  private messageInfo(state: AssistantState): Message {
    return {
      id: state.id,
      sessionID: state.sessionID,
      role: "assistant",
      agent: state.agent,
      modelID: state.modelID,
      providerID: state.providerID,
      tokens: state.tokens,
      cost: state.cost,
      finish: state.finish,
      time: { created: state.created, completed: state.completed },
    }
  }

  // step.ended carries final tokens/cost/finish for that step's message.
  private patchStepEnded(data: Record<string, unknown>, event: V2EventEnvelope): V1Event | null {
    const messageID = String(data.assistantMessageID ?? "")
    const state = this.assistants.get(messageID)
    if (!state) return null
    const tokens = data.tokens as { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } | undefined
    state.tokens = tokens
      ? {
          input: tokens.input ?? 0,
          output: tokens.output ?? 0,
          reasoning: tokens.reasoning,
          cache: { read: tokens.cache?.read ?? 0, write: tokens.cache?.write ?? 0 },
        }
      : undefined
    state.cost = data.cost as number | undefined
    state.finish = (data.finish as string) ?? state.finish
    state.completed = state.completed ?? event.created
    return { type: "message.updated", properties: { info: this.messageInfo(state) } }
  }

  private partUpdated(
    data: Record<string, unknown>,
    kind: "text" | "reasoning",
    text: string,
  ): V1Event {
    const messageID = String(data.assistantMessageID ?? "")
    return {
      type: "message.part.updated",
      properties: {
        part: {
          id: `${messageID}_${kind}${data.ordinal ?? 0}`,
          sessionID: String(data.sessionID ?? ""),
          messageID,
          type: kind,
          text,
        },
      },
    }
  }

  private rendererPart(
    data: Record<string, unknown>,
    kind: "text" | "reasoning",
    text: string,
  ): Part {
    const messageID = String(data.assistantMessageID ?? "")
    return {
      id: `${messageID}_${kind}${data.ordinal ?? 0}`,
      sessionID: String(data.sessionID ?? ""),
      messageID,
      type: kind,
      text,
    }
  }

  private toolPartUpdated(
    data: Record<string, unknown>,
    patch: { status: PartStateStatus; input?: unknown; output?: string; error?: { message: string }; title?: string },
    at?: number,
  ): V1Event {
    const messageID = String(data.assistantMessageID ?? "")
    const callID = String(data.id ?? "")
    const toolName = String(data.name ?? "") || this.toolNames.get(callID) || ""
    if (data.name) this.toolNames.set(callID, String(data.name))
    // V2 tool parts carry no state.time at all (checked against the live
    // server), so the card had nothing to measure and showed no duration for
    // any tool. Synthesize it from the event timestamps: the first event of a
    // call opens the window, the terminal one closes it.
    const now = at ?? Date.now()
    const timing = this.toolTimes.get(callID) ?? { start: now }
    if (timing.end === undefined && (patch.status === "completed" || patch.status === "error")) {
      timing.end = Math.max(now, timing.start)
    }
    this.toolTimes.set(callID, timing)
    const part: Part = {
      id: `tc_${callID}`,
      sessionID: String(data.sessionID ?? ""),
      messageID,
      type: "tool",
      tool: toolName,
      callID,
      state: {
        status: patch.status,
        time: timing.end === undefined ? { start: timing.start } : { start: timing.start, end: timing.end },
        ...(patch.input !== undefined ? { input: patch.input } : {}),
        ...(patch.output !== undefined ? { output: patch.output } : {}),
        ...(patch.error ? { error: patch.error } : {}),
        // session.tool.progress carries what the tool is doing in
        // metadata.title and nothing else — dropping it left a long-running
        // tool as a bare name with no way to tell what it was executing.
        ...(patch.title ? { title: patch.title } : {}),
      },
    } as Part
    return { type: "message.part.updated", properties: { part } }
  }

  private toolNames = new Map<string, string>()

  private prune() {
    // BUG-028: include all tracked maps in the early-return condition —
    // toolInputs/toolNames/reasoningAccum grow unbounded on long sessions even
    // when assistants+textAccum stay under the limit.
    if (
      this.assistants.size <= MAX_TRACKED &&
      this.textAccum.size <= MAX_TRACKED &&
      this.reasoningAccum.size <= MAX_TRACKED &&
      this.toolInputs.size <= MAX_TRACKED &&
      this.toolTimes.size <= MAX_TRACKED &&
      this.toolNames.size <= MAX_TRACKED
    )
      return
    // Drop everything past the most recent MAX_TRACKED messages to cap memory
    // on long-lived connections. Streaming continues fine: a new message ID
    // just re-registers on its next event.
    while (this.assistants.size > MAX_TRACKED) {
      const oldest = this.assistants.keys().next().value
      if (oldest === undefined) break
      this.assistants.delete(oldest)
      this.seenMessageIDs.delete(oldest)
    }
    while (this.textAccum.size > MAX_TRACKED) this.textAccum.delete(this.textAccum.keys().next().value!)
    while (this.reasoningAccum.size > MAX_TRACKED)
      this.reasoningAccum.delete(this.reasoningAccum.keys().next().value!)
    while (this.toolInputs.size > MAX_TRACKED) this.toolInputs.delete(this.toolInputs.keys().next().value!)
    while (this.toolNames.size > MAX_TRACKED) this.toolNames.delete(this.toolNames.keys().next().value!)
  }
}

type PartStateStatus = "pending" | "running" | "completed" | "error"

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// GET /api/permission/request entries → the app's permission prompt shape.
export function mapPermissions(raw: unknown): Array<{
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  tool?: { messageID: string; callID: string }
}> {
  const list = Array.isArray(raw) ? raw : []
  return (list as Record<string, unknown>[]).map((p) => {
    const source = p.source as { messageID?: string; id?: string } | undefined
    return {
      id: (p.id as string) ?? "",
      sessionID: (p.sessionID as string) ?? "",
      permission: (p.action as string) ?? "",
      patterns: (p.resources as string[]) ?? [],
      metadata: {},
      tool: source?.messageID ? { messageID: source.messageID, callID: source.id ?? "" } : undefined,
    }
  })
}
