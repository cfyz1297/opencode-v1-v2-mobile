import { test } from "node:test"
import assert from "node:assert/strict"
import { scrubUrl, scrubString, scrubObject, redactHostAndUrls } from "./scrub.ts"

// scrubUrl ----------------------------------------------------------------

test("scrubUrl: strips basic-auth credentials", () => {
  assert.equal(
    scrubUrl("https://user:secret@host.com/path"),
    "https://<redacted>@host.com/path",
  )
})

// A password may itself contain '@'; the old first-'@' match left the tail of
// it readable in a report the user pastes into an issue. ('/' cannot appear in
// userinfo — such a URL has no credentials, the text is already a path.)
test("scrubUrl: strips the whole userinfo, not up to the first @", () => {
  assert.equal(scrubUrl("https://me:p@ssw0rd@host.com/path"), "https://<redacted>@host.com/path")
})

test("scrubUrl: a token used as userinfo is removed too", () => {
  assert.equal(scrubUrl("https://tok_secret@host:4096/api"), "https://<redacted>@host:4096/api")
  assert.equal(scrubUrl("https://tok%40en@host:4096/api"), "https://<redacted>@host:4096/api")
})

test("scrubUrl: a // inside the path is not userinfo", () => {
  assert.equal(scrubUrl("https://host.com/a//b@c"), "https://host.com/a//b@c")
  assert.equal(scrubUrl("//user:pw@host/path"), "//<redacted>@host/path")
})

test("scrubString: local file URIs never reach a shared report", () => {
  // The picked file's own name and the app cache path live in a file:// or
  // content:// URI, which the report used to publish untouched.
  assert.equal(scrubString("open file:///data/user/0/app/cache/x.png failed"), "open <redacted-local-uri>")
  assert.equal(scrubString("InputStream for content://media/x was null."), "InputStream for <redacted-local-uri>")
  // Case-insensitive, and an unencoded space does not leave the name behind.
  assert.equal(scrubString("FILE:///cache/Screenshot 2026-11-23.png"), "<redacted-local-uri>")
})

test("scrubUrl: redacts ?token= query param", () => {
  assert.equal(
    scrubUrl("https://host.com/api?token=abc123"),
    "https://host.com/api?token=<redacted>",
  )
})

test("scrubUrl: redacts ?api_key= query param", () => {
  assert.equal(
    scrubUrl("https://host.com/api?api_key=xyz"),
    "https://host.com/api?api_key=<redacted>",
  )
})

test("scrubUrl: redacts ?password= query param", () => {
  assert.equal(
    scrubUrl("https://host.com/login?password=hunter2"),
    "https://host.com/login?password=<redacted>",
  )
})

test("scrubUrl: redacts ?access_token= query param", () => {
  assert.equal(
    scrubUrl("https://host.com/api?access_token=tok_secret"),
    "https://host.com/api?access_token=<redacted>",
  )
})

test("scrubUrl: leaves clean URL unchanged", () => {
  const clean = "http://100.108.64.76:4096/session"
  assert.equal(scrubUrl(clean), clean)
})

test("scrubUrl: redacts only secret params, leaves others intact", () => {
  const result = scrubUrl("https://host.com/api?foo=bar&token=secret&baz=qux")
  assert.equal(result, "https://host.com/api?foo=bar&token=<redacted>&baz=qux")
})

// scrubString -------------------------------------------------------------

test("scrubString: replaces credentials in a URL embedded in a message", () => {
  const msg = "fetch failed: https://admin:pass@myserver.com/api"
  const result = scrubString(msg)
  assert.ok(result.includes("<redacted>"), "should contain <redacted>")
  assert.ok(!result.includes("admin"), "should not contain username")
  assert.ok(!result.includes("pass"), "should not contain password")
})

test("scrubString: redacts token query param inside a message", () => {
  const msg = "request to https://api.example.com/data?token=s3cr3t failed"
  const result = scrubString(msg)
  assert.ok(result.includes("token=<redacted>"), "token should be redacted")
  assert.ok(!result.includes("s3cr3t"), "secret value should be gone")
})

test("scrubString: leaves plain strings without URLs unchanged", () => {
  const plain = "something went wrong during connection"
  assert.equal(scrubString(plain), plain)
})

// scrubObject -------------------------------------------------------------

test("scrubObject: scrubs string values containing URLs", () => {
  const obj = { url: "https://user:pw@host.com/path" }
  const result = scrubObject(obj)
  assert.ok((result.url as string).includes("<redacted>"))
  assert.ok(!(result.url as string).includes("pw"))
})

test("scrubObject: recursively scrubs nested objects", () => {
  const obj = {
    outer: "clean",
    inner: {
      url: "https://host.com/api?token=secret",
      label: "safe text",
    },
  }
  const result = scrubObject(obj)
  const inner = result.inner as Record<string, unknown>
  assert.equal(inner.url, "https://host.com/api?token=<redacted>")
  assert.equal(inner.label, "safe text")
  assert.equal(result.outer, "clean")
})

test("scrubObject: preserves non-string, non-object values as-is", () => {
  const obj = { count: 42, flag: true, items: [1, 2, 3], nothing: null }
  const result = scrubObject(obj as Record<string, unknown>)
  assert.equal(result.count, 42)
  assert.equal(result.flag, true)
  assert.deepEqual(result.items, [1, 2, 3])
  assert.equal(result.nothing, null)
})

// redactHostAndUrls -------------------------------------------------------

test("redactHostAndUrls: strips URLs, bare host occurrences, credentials", () => {
  const host = "my-dev-box.tail1234.ts.net"
  const text = [
    `Target URL:  https://user:pw@${host}:4096/api`,
    `  scheme=https host=${host} port=4096 hostname=true`,
    `probe start http://${host}:4096/global/health`,
    "internet https://www.gstatic.com/generate_204 OK",
  ].join("\n")
  const out = redactHostAndUrls(text, [host])
  assert.ok(!out.includes(host), "host must not survive")
  assert.ok(!out.includes("user:pw"), "credentials must not survive")
  assert.ok(out.includes("<redacted-url>"))
  assert.ok(out.includes("host=<redacted-host>"))
})

test("redactHostAndUrls: redacts every session host, not just the report's own", () => {
  // Crash-report case: report.host is undefined but earlier failed-connect
  // log lines mention hosts without a scheme.
  const text = ['{"host":"box-a.tailnet.ts.net","port":"4096"}', "server unreachable box-b.local:8080"].join("\n")
  const out = redactHostAndUrls(text, [undefined, "box-a.tailnet.ts.net", "box-b.local"])
  assert.ok(!out.includes("box-a.tailnet.ts.net"))
  assert.ok(!out.includes("box-b.local"))
})

test("redactHostAndUrls: blanks bare IPv4 addresses even when unknown", () => {
  const out = redactHostAndUrls("connect failed 192.168.1.50:4096 via 10.0.0.1", [])
  assert.ok(!out.includes("192.168.1.50"))
  assert.ok(!out.includes("10.0.0.1"))
  assert.ok(out.includes("<redacted-ip>"))
})

// parseUrl accepts a mixed-case scheme, so `HTTP://u:p@host` is a valid
// connection URL and reaches the report. A case-sensitive dispatch left the
// password in the Target URL line the user pastes into an issue.
test("scrubString: an uppercase scheme still gets its userinfo stripped", () => {
  assert.equal(scrubString("Target URL:  HTTP://u:p@host:4096"), "Target URL:  HTTP://<redacted>@host:4096")
  assert.equal(scrubString("HTTPS://u:p@host"), "HTTPS://<redacted>@host")
})

// A native error names the app's own sandbox path without a scheme, so the
// file:// rule above never saw it (ImageManipulator's FileNotFoundException).
// The path goes, the reason stays: a report without a reason is a guessing game.
test("scrubString: a bare app-sandbox path is dropped but the reason stays", () => {
  assert.equal(
    scrubString("java.io.FileNotFoundException: /data/user/0/com.example/cache/ImagePicker/9f3a.jpg: open failed: EACCES"),
    "java.io.FileNotFoundException: <redacted-path>: open failed: EACCES",
  )
  assert.equal(scrubString("/data/data/com.example/files/db.sqlite locked"), "<redacted-path> locked")
  // Ordinary text is untouched.
  assert.equal(scrubString("npm run build"), "npm run build")
})
