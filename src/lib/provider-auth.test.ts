import { test } from "node:test"
import assert from "node:assert/strict"
import {
  canonicalConnectProviderId,
  connectKeyAttempts,
  redactConnectBody,
  resolveConnectDisplayName,
  shouldTryNextConnectEndpoint,
  validateApiKeyInput,
  validateConnectProviderId,
} from "./provider-auth.ts"

test("validateApiKeyInput rejects empty and tiny keys", () => {
  assert.deepEqual(validateApiKeyInput(""), { ok: false, error: "required" })
  assert.deepEqual(validateApiKeyInput("  "), { ok: false, error: "required" })
  assert.deepEqual(validateApiKeyInput("short"), { ok: false, error: "too_short" })
  assert.deepEqual(validateApiKeyInput("  sk-live-abcdef  "), { ok: true, key: "sk-live-abcdef" })
})

test("connectKeyAttempts tries V2 integration then V1 auth paths", () => {
  const attempts = connectKeyAttempts("anthropic", "sk-test-key-123456")
  assert.equal(attempts.length, 3)
  assert.equal(attempts[0].method, "POST")
  assert.equal(attempts[0].path, "/api/integration/anthropic/connect/key")
  assert.deepEqual(attempts[0].body, { key: "sk-test-key-123456" })
  assert.equal(attempts[1].method, "PUT")
  assert.equal(attempts[1].path, "/auth/anthropic")
  assert.deepEqual(attempts[1].body, { type: "api", key: "sk-test-key-123456" })
  assert.equal(attempts[2].path, "/api/auth/anthropic")
})

test("connectKeyAttempts encodes provider ids", () => {
  const attempts = connectKeyAttempts("github-copilot", "token-value-xx")
  assert.equal(attempts[0].path, "/api/integration/github-copilot/connect/key")
})

test("redactConnectBody never leaks key material", () => {
  const redacted = redactConnectBody({ key: "sk-secret", type: "api", other: 1 })
  assert.equal(redacted.key, "[redacted]")
  assert.equal(redacted.type, "api")
  assert.equal(redacted.other, 1)
})

test("shouldTryNextConnectEndpoint only for missing-route statuses", () => {
  assert.equal(shouldTryNextConnectEndpoint(404), true)
  assert.equal(shouldTryNextConnectEndpoint(405), true)
  assert.equal(shouldTryNextConnectEndpoint(501), true)
  assert.equal(shouldTryNextConnectEndpoint(401), false)
  assert.equal(shouldTryNextConnectEndpoint(400), false)
  assert.equal(shouldTryNextConnectEndpoint(500), false)
})

test("validateConnectProviderId rejects empty and malformed ids", () => {
  assert.deepEqual(validateConnectProviderId(""), { ok: false, error: "required" })
  assert.deepEqual(validateConnectProviderId("Bad Id"), { ok: false, error: "invalid" })
  assert.deepEqual(validateConnectProviderId("anthropic"), { ok: true, id: "anthropic" })
  assert.deepEqual(validateConnectProviderId(" GitHub-Copilot "), { ok: true, id: "GitHub-Copilot" })
})

test("validateConnectProviderId accepts real catalog ids the connect screen must edit", () => {
  // 302ai and wafer.ai are live models.dev ids; a dot or leading digit must not
  // dead-end the change-key screen.
  assert.deepEqual(validateConnectProviderId("302ai"), { ok: true, id: "302ai" })
  assert.deepEqual(validateConnectProviderId("wafer.ai"), { ok: true, id: "wafer.ai" })
  assert.deepEqual(validateConnectProviderId("MyProvider"), { ok: true, id: "MyProvider" })
  assert.equal(validateConnectProviderId("../etc/passwd").ok, false)
  assert.equal(validateConnectProviderId("a/b").ok, false)
})

test("canonicalConnectProviderId keeps the catalog spelling of a case variant", () => {
  const known = ["anthropic", "wafer.ai", "MyProvider"]
  assert.equal(canonicalConnectProviderId("anthropic", known), "anthropic")
  assert.equal(canonicalConnectProviderId("Anthropic", known), "anthropic")
  assert.equal(canonicalConnectProviderId("ANTHROPIC", known), "anthropic")
  assert.equal(canonicalConnectProviderId("MyProvider", known), "MyProvider")
  assert.equal(canonicalConnectProviderId("Myprovider", known), "MyProvider")
  assert.equal(canonicalConnectProviderId("acme", known), "acme")
})

test("resolveConnectDisplayName never takes the name from a deep link", () => {
  assert.equal(resolveConnectDisplayName("evil", "Evil Co"), "Evil Co")
  // A crafted ?name= could label a key write to one vendor as another.
  assert.equal(resolveConnectDisplayName("wafer.ai", undefined), "wafer.ai")
  assert.equal(resolveConnectDisplayName("wafer.ai", "  "), "wafer.ai")
})
