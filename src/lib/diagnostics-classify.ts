// Pure URL parsing + connection-failure classification, extracted from diagnostics.ts
// so this decision logic (which produces the user-facing "why did connecting fail"
// guidance) is unit-testable without react-native / expo-clipboard / expo-device.

export type Classification =
  | "ok"
  | "malformed-url"
  | "no-internet"
  | "server-unreachable"
  | "auth-failed"
  | "health-failed"
  | "tls-error"
  | "timeout"
  | "unknown"

export interface ProbeAttempt {
  name: string
  target: string
  ok: boolean
  status?: number
  contentType?: string
  durationMs: number
  error?: string
  errorCause?: string
}

/** Pick the health probe that identifies the server, and with it the API
 *  generation. Unknown routes on both server generations answer 200 with the
 *  web SPA's HTML, so only a JSON answer (or an auth rejection, which proves
 *  the route exists) counts. */
export function chooseHealthProbe(
  v2: ProbeAttempt,
  v1: ProbeAttempt,
): { attempt: ProbeAttempt; api?: "v1" | "v2" } {
  if (v2.ok) return { attempt: v2, api: "v2" }
  if (v2.status === 401 || v2.status === 403) return { attempt: v2, api: "v2" }
  if (v1.ok || v1.status === 401 || v1.status === 403) return { attempt: v1, api: "v1" }
  return { attempt: v2 }
}

export interface ParsedUrl {
  valid: boolean
  scheme?: string
  host?: string
  port?: string
  isHostname: boolean
}

// Hermes' built-in URL is incomplete (hostname/port often unreliable), so parse
// with a regex instead of `new URL`.
export function parseUrl(url: string): ParsedUrl {
  // Take the whole authority, then drop the userinfo. The old host group
  // excluded only /:?#, so a credential pasted as userinfo (https://token@host)
  // was reported as the host and echoed into the diagnostic report.
  const m = url.trim().match(/^(https?):\/\/([^/?#]+)/i)
  if (!m) return { valid: false, isHostname: false }
  const scheme = m[1].toLowerCase()
  const authority = m[2].slice(m[2].lastIndexOf("@") + 1)
  const hostPort = authority.match(/^([^:]+)(?::(\d+))?$/)
  if (!hostPort) return { valid: false, isHostname: false }
  const host = hostPort[1]
  const port = hostPort[2] || (scheme === "https" ? "443" : "80")
  const isHostname = !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  return { valid: true, scheme, host, port, isHostname }
}

export function classify(
  parsed: ParsedUrl,
  health: ProbeAttempt,
  internet: ProbeAttempt,
  root: ProbeAttempt,
): { classification: Classification; summary: string } {
  if (!parsed.valid) {
    return { classification: "malformed-url", summary: "The server URL could not be parsed. Check for typos or extra characters." }
  }
  if (health.ok) {
    return { classification: "ok", summary: "Health endpoint responded — connection actually works now." }
  }

  // 401/403 means the server is up, reachable, and talking to us — it just
  // rejected our credentials. That needs the opposite instruction from every
  // other failure below (fix the password, not the network), so it gets its
  // own classification rather than being folded into the generic
  // "health-failed / likely wrong path, auth, or an old server version".
  //
  // This is the tail of AGE-107: one device produced 498 `API Error: 401`
  // events over two months because v0.4.4's probe counted any HTTP response
  // as ok:true and told the user "connection actually works now" while the
  // password was wrong. `requireOk` (v0.4.8) stopped the lie; this makes the
  // remaining message actionable so the user stops retrying blind.
  if (health.status === 401 || health.status === 403) {
    return {
      classification: "auth-failed",
      summary:
        `The server rejected your credentials (HTTP ${health.status}). ` +
        `Check the password, and the username if you set OPENCODE_SERVER_USERNAME on the server ` +
        `(it defaults to "opencode"). The server itself is running and reachable.`,
    }
  }

  const txt = `${health.error ?? ""} ${health.errorCause ?? ""}`.toLowerCase()
  const isTls = /ssl|tls|certificate|trust|handshake/.test(txt)
  const isTimeout = /timeout|timed out/.test(txt)

  if (isTls) {
    return { classification: "tls-error", summary: "TLS/certificate problem. Try http:// instead of https://, or fix the server certificate." }
  }
  // The user's own server responded to *something* (even a 401/403/404) —
  // that proves the path to the server works, so a failed public-internet
  // probe (captive portal, no WAN but Tailscale LAN still up, etc.) must not
  // override it and misreport a reachable server as "no internet".
  if (root.ok) {
    return { classification: "health-failed", summary: `Server is reachable but /global/health failed (HTTP ${health.status ?? "error"}). Likely a wrong path or an old server version.` }
  }
  if (!internet.ok) {
    return { classification: "no-internet", summary: "The device has no working internet/network at all (public check also failed). Check Wi-Fi/data and Tailscale (VPN) status." }
  }
  // Internet works, server does not.
  if (isTimeout) {
    return { classification: "timeout", summary: "Connection to the server timed out (dropped, not refused). Likely a firewall, wrong port, or Tailscale ACL blocking the device." }
  }
  return {
    classification: "server-unreachable",
    summary:
      `Internet works, but the server at ${parsed.host}:${parsed.port} is unreachable. ` +
      (parsed.isHostname
        ? "Hostname may not resolve from this device (MagicDNS off?). Try the raw Tailscale IP. "
        : "") +
      "Confirm the opencode server is running, the device is on the same tailnet, and the port is correct.",
  }
}
