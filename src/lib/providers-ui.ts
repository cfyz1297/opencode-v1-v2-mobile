/** Pure helpers for Settings ? Providers screen (server-backed; no secrets). */

/**
 * Catalog of providers shown under Popular.
 * IDs match OpenCode `/connect` where possible.
 * Descriptions use i18n: special keys when present, else providers.popular.generic.
 */

export interface PopularProviderDef {
  id: string
  name: string
  /** Optional i18n key; default providers.popular.generic.description */
  descriptionKey?: string
  /** Account-style providers (OpenCode Go/Zen, Copilot, ...) */
  badge?: "account" | "api_key"
}

/**
 * Short popular list ? OpenCode first, then by common usage.
 * Other / custom stays a separate always-on entry.
 */
export const POPULAR_PROVIDERS: readonly PopularProviderDef[] = [
  {
    id: "opencode",
    name: "OpenCode Zen",
    descriptionKey: "providers.popular.opencode.description",
    badge: "account",
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    descriptionKey: "providers.popular.opencodeGo.description",
    badge: "account",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    descriptionKey: "providers.popular.anthropic.description",
  },
  {
    id: "openai",
    name: "OpenAI",
    descriptionKey: "providers.popular.openai.description",
  },
  {
    id: "google",
    name: "Google",
    descriptionKey: "providers.popular.google.description",
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    descriptionKey: "providers.popular.githubCopilot.description",
    badge: "account",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
  },
  {
    id: "groq",
    name: "Groq",
  },
  {
    id: "xai",
    name: "xAI",
  },
  {
    id: "ollama",
    name: "Ollama",
  },
  {
    id: "beatapi",
    name: "BeatAPI",
    descriptionKey: "providers.popular.beatapi.description",
  },
  {
    id: "azure",
    name: "Azure OpenAI",
  },
  {
    id: "amazon-bedrock",
    name: "Amazon Bedrock",
  },
] as const

/** Always shown; opens the custom OpenAI-compatible provider flow. */
export const CUSTOM_PROVIDER_ENTRY = {
  id: "other",
  name: "Other (Custom)",
  descriptionKey: "providers.popular.other.description",
} as const

/** Expo Router paths. */
export const PROVIDERS_ROUTE = "/providers" as const
export const CUSTOM_PROVIDER_ROUTE = "/providers/custom" as const
export const CONNECT_PROVIDER_ROUTE = "/providers/connect" as const

export type ConnectionBadge = "account" | "api_key"

export interface CatalogProviderModel {
  id: string
  name: string
  free?: boolean
}

export interface CatalogProvider {
  id: string
  name: string
  connected: boolean
  models: CatalogProviderModel[]
}

export interface ConnectedProviderRow {
  id: string
  name: string
  modelCount: number
  badge: ConnectionBadge
}

export interface PopularProviderRow {
  id: string
  name: string
  descriptionKey: string
  badge: ConnectionBadge
  /** Opens custom provider form instead of connect screen */
  isCustom?: boolean
}

export interface ProvidersScreenModel {
  connected: ConnectedProviderRow[]
  popular: PopularProviderRow[]
  /** Always present ? Other / Custom entry */
  custom: PopularProviderRow
}

const ACCOUNT_PROVIDER_IDS = new Set([
  "opencode",
  "opencode-go",
  "opencode-zen",
  "opencode-console",
  "github-copilot",
  "copilot",
])

/** Aliases so connecting one OpenCode id hides related popular rows. */
const CONNECTED_ALIASES: Record<string, string[]> = {
  opencode: ["opencode-zen"],
  "opencode-zen": ["opencode"],
  "github-copilot": ["copilot"],
  copilot: ["github-copilot"],
}

export function connectionBadgeFor(providerID: string, hint?: PopularProviderDef["badge"]): ConnectionBadge {
  if (hint === "account" || hint === "api_key") return hint
  const id = providerID.toLowerCase()
  if (ACCOUNT_PROVIDER_IDS.has(id)) return "account"
  if (id.startsWith("opencode")) return "account"
  return "api_key"
}

export function isFreeModel(cost?: { input?: number; output?: number } | null): boolean {
  if (cost == null) return true
  const input = cost.input ?? 0
  const output = cost.output ?? 0
  return input === 0 && output === 0
}

export function descriptionKeyFor(def: PopularProviderDef): string {
  return def.descriptionKey || "providers.popular.generic.description"
}

function expandConnectedIds(ids: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const raw of ids) {
    const id = raw.toLowerCase()
    out.add(id)
    for (const alias of CONNECTED_ALIASES[id] || []) out.add(alias)
  }
  return out
}

/** Exact id only: the name shown must belong to the id the key is written to.
 * A case variant is not a catalog match, so the screen shows the id instead. */
export function findPopularProvider(id: string): PopularProviderDef | undefined {
  return POPULAR_PROVIDERS.find((p) => p.id === id)
}

/** The screen resolves the name from the catalog and id, so no name is passed:
 * a query string label could misname the provider the key is written to. */
export function connectHref(providerID: string): string {
  return `${CONNECT_PROVIDER_ROUTE}?${new URLSearchParams({ id: providerID }).toString()}`
}

export function buildProvidersScreenModel(
  connectedProviders: CatalogProvider[],
  query = "",
): ProvidersScreenModel {
  const connected: ConnectedProviderRow[] = (Array.isArray(connectedProviders) ? connectedProviders : []).map(
    (p) => ({
      id: p.id,
      name: p.name || p.id,
      modelCount: Array.isArray(p.models) ? p.models.length : 0,
      badge: connectionBadgeFor(p.id),
    }),
  )

  const connectedIds = expandConnectedIds(connected.map((p) => p.id))
  const q = query.trim().toLowerCase()

  const popular: PopularProviderRow[] = POPULAR_PROVIDERS.filter((p) => !connectedIds.has(p.id.toLowerCase()))
    .filter(
      (p) =>
        !q ||
        p.id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q),
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      descriptionKey: descriptionKeyFor(p),
      badge: connectionBadgeFor(p.id, p.badge),
    }))

  const custom: PopularProviderRow = {
    id: CUSTOM_PROVIDER_ENTRY.id,
    name: CUSTOM_PROVIDER_ENTRY.name,
    descriptionKey: CUSTOM_PROVIDER_ENTRY.descriptionKey,
    badge: "api_key",
    isCustom: true,
  }

  return { connected, popular, custom }
}

/** Guards against accidental shrink / empty catalog regressions. */
export const MIN_POPULAR_PROVIDER_COUNT = 10
export const MAX_POPULAR_PROVIDER_COUNT = 20
