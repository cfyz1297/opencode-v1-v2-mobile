// Pure URL/string scrubbing utilities — no React Native or Sentry deps.
// Extracted here so they can be unit-tested with plain `node --test`.

// Strip basic-auth credentials and any `?token=` style query secrets so URLs
// can be safely sent or logged.
export function scrubUrl(url: string): string {
  return url
    // The whole userinfo, up to the LAST '@' of the authority: a password may
    // itself contain '@' (me:p@ssw0rd@host) and the old first-'@' match left
    // its tail readable in a shared report. Anchored to the scheme (or a
    // protocol-relative '//'), so an '@' after a '//' in a path stays intact.
    .replace(/(^[a-z][a-z0-9+.-]*:\/\/|^\/\/)[^/?#]*@/i, "$1<redacted>@")
    .replace(/([?&](?:token|access_token|api_key|key|password|pwd|auth)=)[^&#]*/gi, "$1<redacted>")
}

export function scrubString(s: string): string {
  // Catch any embedded URL inside a free-text string (error messages often
  // contain them, e.g. "fetch failed: https://user:pw@host/...").
  // Local schemes carry the picked file's own name and the app's cache path;
  // they used to pass through untouched into the report the user shares.
  return s
    // /i: parseUrl accepts a mixed-case scheme, so `HTTP://u:p@host` is a
    // valid connection URL — a case-sensitive dispatch would publish it.
    .replace(/https?:\/\/\S+/gi, (m) => scrubUrl(m))
    .replace(/\b(?:file|content):\/\/[^\n]*/gi, "<redacted-local-uri>")
    // Native errors name the app's own sandbox path without a scheme
    // ("... /data/user/0/<pkg>/cache/ImagePicker/x.jpg: open failed: EACCES").
    // Drop the path, keep the reason: that keeps the report diagnosable. The
    // leading character is matched so a URL that merely contains /data/ is not
    // mangled.
    // shortcut: stops at a space or colon, so a user-visible name with either
    // leaks its tail; today both pickers copy under a UUID name. Narrow this
    // when a path carrying a user's own filename reaches the log.
    .replace(/(^|[\s'"=(])\/data\/(?:user\/\d+|data)\/[^\s:]*/g, "$1<redacted-path>")
}

// Harder redaction for text that leaves the device (support inbox): drop
// every URL wholesale, erase every known server host (bare `host=…` fragments
// and log lines carry hosts without a scheme, which the URL regex misses),
// and blank bare IPv4 addresses as a catch-all for hosts we never parsed.
export function redactHostAndUrls(text: string, hosts?: Array<string | undefined>): string {
  let out = text.replace(/https?:\/\/[^\s)\]}"']+/gi, "<redacted-url>")
  for (const host of hosts ?? []) {
    if (host) out = out.split(host).join("<redacted-host>")
  }
  out = out.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<redacted-ip>")
  return out
}

export function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") out[k] = scrubString(v)
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = scrubObject(v as Record<string, unknown>)
    else out[k] = v
  }
  return out
}
