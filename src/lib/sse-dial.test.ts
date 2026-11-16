// One SSE handshake, shared by both transports. The body must keep streaming,
// so this cannot go through http.ts's fetchWithTimeout(): that one uses the
// XHR-backed global fetch, which loses ReadableStream on native. A server that
// accepts the socket and then never sends headers (black-holed host, half-open
// proxy socket) would otherwise leave connect() pending forever while the
// caller has already reported "connected" — abort the dial instead and let the
// reconnect cycle take over.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dialStream } from "./sse.ts"

// A fetch that never answers and rejects only when its signal aborts — the
// black-holed host the timeout exists for.
function hangingFetch(seen: AbortSignal[] = []): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal as AbortSignal
    seen.push(signal)
    return await new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
    })
  }) as typeof fetch
}

test("a dial that never gets headers is aborted at the deadline", async () => {
  const controller = new AbortController()
  const seen: AbortSignal[] = []
  await assert.rejects(
    dialStream(hangingFetch(seen), "https://example.test/event", {}, 20),
    /abort/i,
  )
  // The caller's own signal must stay untouched: the timeout is the dial's.
  assert.equal(controller.signal.aborted, false)
})

test("a dial that answers keeps its body and clears the timer", async () => {
  const body = new ReadableStream<Uint8Array>({ start: (c) => c.close() })
  const response = await dialStream(
    (async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
    "https://example.test/event",
    {},
    20,
  )
  assert.equal(response.status, 200)
  assert.equal(response.body, body, "the streaming body must be handed through untouched")
  // The timer is cleared on success; five deadlines later nothing has aborted.
  await new Promise((resolve) => setTimeout(resolve, 60))
})

test("aborting the caller's signal aborts the dial immediately", async () => {
  const controller = new AbortController()
  const dial = dialStream(hangingFetch(), "https://example.test/event", { signal: controller.signal }, 10_000)
  controller.abort()
  await assert.rejects(dial, /abort/i)
})

// Source-level guard: both transports must dial through the shared deadline.
// A re-added raw expoFetch in either one silently reintroduces the hang this
// file exists for (v1 had it until 0.3.22).
test("both transports dial through the shared deadline", () => {
  for (const file of ["sdk.ts", "sdk-v1.ts"]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8")
    assert.match(source, /dialStream\(expoFetch, url, \{[^}]*\}, CONNECT_TIMEOUT_MS\)/, `${file} must dial through dialStream`)
    assert.doesNotMatch(source, /await expoFetch\(/, `${file} must not dial the event stream directly`)
  }
})
