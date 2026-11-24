/**
 * Provider connect payloads and endpoint selection for opencode serve.
 * Keys are sent to the server only — never persisted by these helpers.
 */

export type ProviderAuthPayload = { type: "api"; key: string }

export interface ConnectKeyAttempt {
  /** Relative path on the opencode server */
  path: string
  method: "POST" | "PUT"
  body: Record<string, unknown>
}

/** Ordered attempts: V2 integration connect, then classic V1 auth.set */
export function connectKeyAttempts(providerID: string, apiKey: string): ConnectKeyAttempt[] {
  const id = encodeURIComponent(providerID)
  const key = apiKey
  return [
    {
      path: `/api/integration/${id}/connect/key`,
      method: "POST",
      body: { key },
    },
    {
      path: `/auth/${id}`,
      method: "PUT",
      body: { type: "api", key } satisfies ProviderAuthPayload,
    },
    // Some builds nest under /api
    {
      path: `/api/auth/${id}`,
      method: "PUT",
      body: { type: "api", key } satisfies ProviderAuthPayload,
    },
  ]
}

export function validateApiKeyInput(raw: string): { ok: true; key: string } | { ok: false; error: "required" | "too_short" } {
  const key = (raw || "").trim()
  if (!key) return { ok: false, error: "required" }
  if (key.length < 8) return { ok: false, error: "too_short" }
  return { ok: true, key }
}

/** Provider ids accepted by connect screen (matches OpenCode /connect style).
 * Catalog ids may start with a digit or contain dots (`302ai`, `wafer.ai`), and
 * case is meaningful: the server keys auth by the exact id. No slash, no leading
 * dot/dash, 64 chars max; connectKeyAttempts also URI-encodes it. */
const CONNECT_PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function validateConnectProviderId(
  raw: string,
): { ok: true; id: string } | { ok: false; error: "required" | "invalid" } {
  const id = (raw || "").trim()
  if (!id) return { ok: false, error: "required" }
  if (!CONNECT_PROVIDER_ID_RE.test(id)) return { ok: false, error: "invalid" }
  return { ok: true, id }
}

/** Prefer catalog name over deep-link query to reduce phishing via ?name=. */
export function resolveConnectDisplayName(
  providerID: string,
  queryName: string | undefined,
  catalogName: string | undefined,
): string {
  const fromCatalog = (catalogName || "").trim()
  if (fromCatalog) return fromCatalog
  const fromQuery = (queryName || "").trim()
  if (fromQuery && fromQuery.length <= 80 && !/[\x00-\x1f\x7f]/.test(fromQuery)) return fromQuery
  return providerID
}

/** Strip secrets from objects before logging / error reporting. */
export function redactConnectBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body }
  if ("key" in out) out.key = "[redacted]"
  if ("apiKey" in out) out.apiKey = "[redacted]"
  if ("token" in out) out.token = "[redacted]"
  return out
}

export function isConnectSuccessStatus(status: number): boolean {
  return status === 200 || status === 204
}

export function shouldTryNextConnectEndpoint(status: number): boolean {
  return status === 404 || status === 405 || status === 501
}
