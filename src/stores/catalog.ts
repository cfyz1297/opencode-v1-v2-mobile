import { create } from "zustand"
import { useConnections } from "./connections"
import type { Agent, Command } from "../lib/sdk"
import { chooseModelSelection } from "../lib/model-selection"
import { isFreeModel } from "../lib/providers-ui"

export interface ProviderModel {
  id: string
  name: string
  reasoning: boolean
  attachment: boolean
  free?: boolean
  // Catalog prices per million tokens — the chat footer falls back to these
  // when the server reports cost 0 (see message-run.runTotals).
  cost?: { input: number; output: number; cache?: { read: number; write: number } }
  limit?: { context: number; output: number }
  variants?: Record<string, { reasoningEffort?: string }>
}

export interface Provider {
  id: string
  name: string
  connected: boolean
  models: ProviderModel[]
}

interface ModelSelection {
  providerID: string
  modelID: string
}

function sameModel(left: ModelSelection | null, right: ModelSelection | null) {
  return left?.providerID === right?.providerID && left?.modelID === right?.modelID
}

interface CatalogState {
  catalogClient: import("../lib/sdk").Client | null
  catalogConnection: string | null
  agents: Agent[]
  commands: Command[]
  providers: Provider[]
  defaults: Record<string, string>
  // Current selections
  agent: string // agent id for API switches (e.g. "build"); display name lives on the agent record
  model: ModelSelection | null
  variant: string | null // model variant for reasoning effort (e.g. "low", "medium", "high")
  loaded: boolean

  // Actions
  load: () => Promise<void>
  setAgent: (name: string) => void
  setModel: (selection: ModelSelection | null) => void
  setVariant: (variant: string | null) => void
  cycleAgent: (direction?: 1 | -1) => void
}

export const useCatalog = create<CatalogState>((set, get) => ({
  catalogClient: null,
  catalogConnection: null,
  agents: [],
  commands: [],
  providers: [],
  defaults: {},
  agent: "",
  model: null,
  variant: null,
  loaded: false,

  load: async () => {
    const { client, activeConnection } = useConnections.getState()
    const scope = activeConnection?.id ?? null
    if (!client) return

    const [agentResult, commandResult, providerResult] = await Promise.all([
      client.agent.list().catch(() => [] as Agent[]),
      client.command.list().catch(() => [] as Command[]),
      client.provider.list().catch(() => null),
    ])

    // Ignore in-flight responses from a connection that is no longer active.
    if (useConnections.getState().client !== client || (useConnections.getState().activeConnection?.id ?? null) !== scope) return

    const agents = Array.isArray(agentResult) ? agentResult : []
    const commands = Array.isArray(commandResult) ? commandResult : []

    // Parse provider response: { all: [...], default: {...}, connected: [...] }
    const raw = providerResult
    const connected = new Set(Array.isArray(raw?.connected) ? raw.connected : [])
    const defaults = raw?.default || {}
    // A failed fetch (providerResult null — server asleep, phone just
    // unlocked, request timed out) must not erase the catalog: the model and
    // reasoning-effort pickers read `providers` from here, so an empty list
    // leaves both sheets blank until something else calls load() again. Only
    // for the same connection though — another server's models are not ours.
    const providers: Provider[] = Array.isArray(raw?.all)
      ? raw.all
          .filter((p) => connected.has(p.id))
          .map((p) => ({
            id: p.id,
            name: p.name || p.id,
            connected: connected.has(p.id),
            models: Object.values(p.models || {})
              .filter((m) => m.status !== "deprecated")
              .map((m) => ({
                id: m.id,
                name: m.name || m.id,
                reasoning: m.reasoning ?? false,
                attachment: m.attachment ?? false,
                free: isFreeModel(m.cost),
                cost: m.cost,
                limit: m.limit,
                variants: m.variants,
              })),
          }))
          .filter((p) => p.models.length > 0)
      : providerResult === null && get().catalogConnection === scope
        ? get().providers
        : []

    // Filter out hidden agents
    const visible = agents.filter((a) => !a.hidden)

    // Default agent. The state stores the server-side ID ("build"), while
    // "Build" is only the display name — V2 accepts a display-name switch
    // (204) but then silently never runs the prompt (see Agent.id comment).
    // Matching by name too migrates selections stored by older builds.
    const current = get().agent
    const currentMatch = visible.find((a) => (a.id ?? a.name) === current || a.name === current)
    const agent = currentMatch
      ? currentMatch.id ?? currentMatch.name
      : visible[0]?.id ?? visible[0]?.name ?? "build"

    // Default model: keep valid existing selection; otherwise prefer connected
    // provider defaults, then first connected model; agent model is last fallback.
    //
    // BUG-015: if the fetch failed (providers is empty because the server is
    // unreachable), preserve the user's existing model choice instead of
    // silently resetting it to null/"server default".
    const existing = get().model
    const defaultAgent = visible[0]
    const model =
      providers.length > 0
        ? chooseModelSelection({
            providers,
            defaults,
            existing,
            agentModel: defaultAgent?.model || null,
          })
        : existing // network failure — keep current choice

    set((state) => ({
      catalogClient: client,
      catalogConnection: scope,
      agents: visible,
      commands,
      providers,
      defaults,
      agent,
      model,
      variant: sameModel(state.model, model) ? state.variant : null,
      loaded: true,
    }))
  },

  setAgent: (idOrName) => {
    const match = get().agents.find((a) => a.id === idOrName || a.name === idOrName)
    if (!match) return
    const model = match.model || get().model
    set((state) => ({
      agent: match.id ?? match.name,
      model,
      variant: sameModel(state.model, model) ? state.variant : null,
    }))
  },

  setModel: (selection) =>
    set((state) => ({
      model: selection,
      variant: sameModel(state.model, selection) ? state.variant : null,
    })),

  setVariant: (variant) => set({ variant }),

  cycleAgent: (direction = 1) => {
    const { agents, agent } = get()
    const primary = agents.filter((a) => a.mode === "primary" || a.mode === "all")
    if (primary.length < 2) return
    const idx = primary.findIndex((a) => (a.id ?? a.name) === agent)
    const next = (idx + direction + primary.length) % primary.length
    get().setAgent(primary[next].id ?? primary[next].name)
  },
}))
