import { test } from "node:test"
import assert from "node:assert/strict"
import { parseUrl, classify, chooseHealthProbe, type ProbeAttempt } from "./diagnostics-classify.ts"

const probe = (over: Partial<ProbeAttempt> = {}): ProbeAttempt => ({
  name: "p",
  target: "t",
  ok: false,
  durationMs: 1,
  ...over,
})

// ---------------- parseUrl ----------------

test("parses scheme, host, and explicit port", () => {
  assert.deepEqual(parseUrl("http://192.168.1.10:4096"), {
    valid: true,
    scheme: "http",
    host: "192.168.1.10",
    port: "4096",
    isHostname: false,
  })
})

test("defaults port to 443 for https and 80 for http", () => {
  assert.equal(parseUrl("https://example.com").port, "443")
  assert.equal(parseUrl("http://example.com").port, "80")
})

test("lowercases the scheme and trims surrounding whitespace", () => {
  const p = parseUrl("  HTTPS://Host.Example  ")
  assert.equal(p.scheme, "https")
  assert.equal(p.host, "Host.Example") // host case is preserved
})

test("flags an IPv4 host as not-a-hostname, and a DNS name as a hostname", () => {
  assert.equal(parseUrl("http://10.0.0.1:8080").isHostname, false)
  assert.equal(parseUrl("http://server.tailnet.ts.net:8080").isHostname, true)
})

// A bracketed IPv6 literal is a valid server address (tailnets hand them out),
// and `host:` means the default port. Both used to pass and must keep passing;
// the userinfo fix must not narrow them.
test("IPv6 literals and an empty port stay valid", () => {
  assert.deepEqual(parseUrl("http://[fd7a:115c:a1e0::1]:4096"), {
    valid: true,
    scheme: "http",
    host: "[fd7a:115c:a1e0::1]",
    port: "4096",
    isHostname: false,
  })
  assert.equal(parseUrl("http://[::1]:4096").host, "[::1]")
  assert.equal(parseUrl("http://host:").port, "80")
  assert.equal(parseUrl("https://host:").port, "443")
})

// A credential pasted as userinfo used to become the host, so the report
// printed it in host=, in the unreachable summary and in the probe-start log.
test("userinfo is not part of the host", () => {
  assert.deepEqual(parseUrl("https://tok_secret@box.tailnet.ts.net:4096"), {
    valid: true,
    scheme: "https",
    host: "box.tailnet.ts.net",
    port: "4096",
    isHostname: true,
  })
  assert.equal(parseUrl("http://alice:correct horse@host:4096").host, "host")
  assert.equal(parseUrl("http://user:p@ss@host").host, "host")
})

test("ignores path, query, and fragment when extracting the host", () => {
  const p = parseUrl("http://host:9000/global/health?x=1#frag")
  assert.equal(p.host, "host")
  assert.equal(p.port, "9000")
})

test("rejects malformed or non-http(s) URLs", () => {
  for (const bad of ["", "not a url", "ftp://host", "host:1234", "://nope", "https://"]) {
    assert.equal(parseUrl(bad).valid, false, `should be invalid: ${JSON.stringify(bad)}`)
  }
})

// ---------------- classify ----------------

const okUrl = parseUrl("http://host:8080")

test("malformed URL short-circuits to malformed-url", () => {
  const r = classify(parseUrl("garbage"), probe(), probe(), probe())
  assert.equal(r.classification, "malformed-url")
})

test("a healthy probe classifies as ok regardless of other probes", () => {
  const r = classify(okUrl, probe({ ok: true, status: 200 }), probe(), probe())
  assert.equal(r.classification, "ok")
})

test("TLS-flavored error wins even when internet is down", () => {
  const r = classify(okUrl, probe({ error: "SSL handshake failed" }), probe({ ok: false }), probe())
  assert.equal(r.classification, "tls-error")
})

test("detects TLS keywords from errorCause too", () => {
  const r = classify(okUrl, probe({ errorCause: "certificate has expired" }), probe({ ok: true }), probe())
  assert.equal(r.classification, "tls-error")
})

test("no internet (and no TLS signal) classifies as no-internet", () => {
  const r = classify(okUrl, probe({ error: "Network request failed" }), probe({ ok: false }), probe())
  assert.equal(r.classification, "no-internet")
})

test("internet up + server root reachable but health failed -> health-failed (includes status)", () => {
  const r = classify(
    okUrl,
    probe({ error: "HTTP 404", status: 404 }),
    probe({ ok: true }), // internet
    probe({ ok: true, status: 404 }), // root reachable
  )
  assert.equal(r.classification, "health-failed")
  assert.match(r.summary, /404/)
})

test("internet up, root unreachable, timeout signal -> timeout", () => {
  const r = classify(
    okUrl,
    probe({ error: "timeout after 8000ms" }),
    probe({ ok: true }),
    probe({ ok: false }),
  )
  assert.equal(r.classification, "timeout")
})

test("internet up, root unreachable, no timeout -> server-unreachable", () => {
  const r = classify(
    okUrl,
    probe({ error: "connection refused" }),
    probe({ ok: true }),
    probe({ ok: false }),
  )
  assert.equal(r.classification, "server-unreachable")
})

test("root reachable but internet probe down still classifies as health-failed, not no-internet", () => {
  // Regression: the user's own server responded (proving the path to it
  // works — e.g. captive portal or no WAN but Tailscale LAN still up), so
  // this must not be misreported as "no internet".
  const r = classify(
    okUrl,
    probe({ ok: false, error: "HTTP 404", status: 404 }), // health
    probe({ ok: false }), // internet (down)
    probe({ ok: true }), // root (reachable)
  )
  assert.equal(r.classification, "health-failed")
})

// --- AGE-107: a rejected credential must not read as anything else ---------
//
// One device sent 498 `API Error: 401` events over two months. The cause was
// not an automated retry loop — it was a human re-tapping Connect because
// v0.4.4's probe scored any HTTP response as ok:true and reported
// "connection actually works now" while the password was wrong. `requireOk`
// stopped that lie; these lock in the follow-up: 401/403 is its own,
// actionable classification, not the generic health-failed bucket.

test("health probe 401 -> auth-failed, and the summary tells the user to fix credentials", () => {
  const r = classify(
    okUrl,
    probe({ ok: false, error: "HTTP 401", status: 401 }), // health
    probe({ ok: true }), // internet
    probe({ ok: true, status: 401 }), // root reachable
  )
  assert.equal(r.classification, "auth-failed")
  assert.match(r.summary, /401/)
  assert.match(r.summary, /credential|password/i)
  // Must NOT tell the user the connection works (the v0.4.4 defect).
  assert.doesNotMatch(r.summary, /actually works/i)
})

test("health probe 403 -> auth-failed too", () => {
  const r = classify(okUrl, probe({ ok: false, status: 403 }), probe({ ok: true }), probe({ ok: true, status: 403 }))
  assert.equal(r.classification, "auth-failed")
  assert.match(r.summary, /403/)
})

test("auth-failed wins even when the server root probe is unreachable", () => {
  // A 401 from /global/health already proves the server answered us; the
  // root probe's outcome must not downgrade this to server-unreachable.
  const r = classify(okUrl, probe({ ok: false, status: 401 }), probe({ ok: true }), probe({ ok: false }))
  assert.equal(r.classification, "auth-failed")
})

test("non-auth failure statuses stay health-failed", () => {
  for (const status of [404, 500, 502]) {
    const r = classify(okUrl, probe({ ok: false, status }), probe({ ok: true }), probe({ ok: true, status }))
    assert.equal(r.classification, "health-failed", `status ${status}`)
  }
})

test("health-failed copy no longer blames auth now that auth-failed exists", () => {
  const r = classify(okUrl, probe({ ok: false, status: 500 }), probe({ ok: true }), probe({ ok: true, status: 500 }))
  assert.doesNotMatch(r.summary, /auth/i)
})

test("server-unreachable adds MagicDNS hint only for hostnames, not IPs", () => {
  const fail = { internet: probe({ ok: true }), root: probe({ ok: false }) }
  const hostR = classify(parseUrl("http://box.ts.net:8080"), probe({ error: "refused" }), fail.internet, fail.root)
  const ipR = classify(parseUrl("http://10.0.0.5:8080"), probe({ error: "refused" }), fail.internet, fail.root)
  assert.match(hostR.summary, /MagicDNS/)
  assert.doesNotMatch(ipR.summary, /MagicDNS/)
})

test("health probe picks the route that exists, not whichever answered first", () => {
  // A v1 server answers /api/info with the SPA (HTML 200, ok forced false by
  // requireJson). Only /global/health proves the API generation.
  const spaIsh = probe({ target: "/api/info", ok: false, status: 200, contentType: "text/html" })
  const v1 = probe({ target: "/global/health", ok: true, status: 200, contentType: "application/json" })
  assert.deepEqual(chooseHealthProbe(spaIsh, v1), { attempt: v1, api: "v1" })
})

test("health probe keeps an auth rejection, since that proves the route exists", () => {
  const v2 = probe({ target: "/api/info", ok: false, status: 401, contentType: "application/json" })
  const v1 = probe({ target: "/global/health", ok: false, status: 404 })
  assert.deepEqual(chooseHealthProbe(v2, v1), { attempt: v2, api: "v2" })
})

test("health probe reports no API when neither route exists", () => {
  const v2 = probe({ target: "/api/info", ok: false, status: 200, contentType: "text/html" })
  const v1 = probe({ target: "/global/health", ok: false, status: 200, contentType: "text/html" })
  assert.deepEqual(chooseHealthProbe(v2, v1), { attempt: v2 })
})
