import { test } from "node:test"
import assert from "node:assert/strict"
import {
  POPULAR_PROVIDERS,
  MIN_POPULAR_PROVIDER_COUNT,
  MAX_POPULAR_PROVIDER_COUNT,
  buildProvidersScreenModel,
  connectHref,
  connectionBadgeFor,
  findPopularProvider,
  isFreeModel,
  type CatalogProvider,
} from "./providers-ui.ts"

function provider(partial: Partial<CatalogProvider> & Pick<CatalogProvider, "id">): CatalogProvider {
  return {
    name: partial.name ?? partial.id,
    connected: partial.connected ?? true,
    models: partial.models ?? [{ id: "m1", name: "Model 1" }],
    ...partial,
  }
}

test("catalog is a short popular list with OpenCode first", () => {
  assert.ok(POPULAR_PROVIDERS.length >= MIN_POPULAR_PROVIDER_COUNT)
  assert.ok(POPULAR_PROVIDERS.length <= MAX_POPULAR_PROVIDER_COUNT)
  assert.equal(POPULAR_PROVIDERS[0].id, "opencode")
  assert.equal(POPULAR_PROVIDERS[1].id, "opencode-go")
  const ids = new Set(POPULAR_PROVIDERS.map((p) => p.id))
  assert.ok(ids.has("anthropic"))
  assert.ok(ids.has("openai"))
  assert.ok(ids.has("beatapi"))
  assert.ok(!ids.has("opencode-console"), "console should not clutter short list")
  assert.ok(!ids.has("frogbot"))
})

test("connectHref builds providers/connect query", () => {
  assert.equal(connectHref("anthropic"), "/providers/connect?id=anthropic")
  assert.equal(connectHref("wafer.ai"), "/providers/connect?id=wafer.ai")
})

test("popular provider ids are unique", () => {
  const ids = POPULAR_PROVIDERS.map((p) => p.id)
  assert.equal(ids.length, new Set(ids).size)
})

test("findPopularProvider matches the exact id the key is written to", () => {
  // A case variant must not borrow the catalog name: the write uses the exact id.
  assert.equal(findPopularProvider("anthropic")?.id, "anthropic")
  assert.equal(findPopularProvider("Anthropic"), undefined)
  assert.equal(findPopularProvider("weird.example"), undefined)
})

test("buildProvidersScreenModel: empty connected keeps full popular list plus custom", () => {
  const model = buildProvidersScreenModel([])
  assert.equal(model.connected.length, 0)
  assert.equal(model.popular.length, POPULAR_PROVIDERS.length)
  assert.equal(model.custom.isCustom, true)
  assert.equal(model.custom.id, "other")
})

test("buildProvidersScreenModel: connected rows come from catalog with model counts", () => {
  const model = buildProvidersScreenModel([
    provider({ id: "opencode-go", name: "OpenCode Go", models: [{ id: "a", name: "A" }, { id: "b", name: "B" }] }),
    provider({ id: "beatapi", name: "BeatAPI", models: [{ id: "c", name: "C" }] }),
  ])
  assert.equal(model.connected.length, 2)
  assert.equal(model.connected[0].id, "opencode-go")
  assert.equal(model.connected[0].modelCount, 2)
  assert.equal(model.connected[0].badge, "account")
  assert.equal(model.connected[1].badge, "api_key")
  assert.ok(!model.popular.some((p) => p.id === "opencode-go"))
  assert.ok(!model.popular.some((p) => p.id === "beatapi"))
})

test("opencode connected hides zen alias and keeps Go available", () => {
  const model = buildProvidersScreenModel([provider({ id: "opencode", name: "OpenCode Zen" })])
  assert.ok(!model.popular.some((p) => p.id === "opencode"))
  assert.ok(model.popular.some((p) => p.id === "opencode-go"))
  assert.equal(model.popular[0]?.id !== "opencode", true)
})

test("buildProvidersScreenModel: query filters popular by name or id", () => {
  const model = buildProvidersScreenModel([], "deep")
  assert.ok(model.popular.length >= 1)
  assert.ok(model.popular.every((p) => /deep/i.test(p.id) || /deep/i.test(p.name)))
  // custom entry is separate and not filtered away
  assert.equal(model.custom.id, "other")
})

test("buildProvidersScreenModel: all popular connected yields empty popular but keeps custom", () => {
  const model = buildProvidersScreenModel(
    POPULAR_PROVIDERS.map((p) => provider({ id: p.id, name: p.name })),
  )
  assert.equal(model.popular.length, 0)
  assert.equal(model.custom.isCustom, true)
})

test("connectionBadgeFor: account-style ids vs api-key", () => {
  assert.equal(connectionBadgeFor("opencode"), "account")
  assert.equal(connectionBadgeFor("opencode-go"), "account")
  assert.equal(connectionBadgeFor("opencode-zen"), "account")
  assert.equal(connectionBadgeFor("github-copilot"), "account")
  assert.equal(connectionBadgeFor("beatapi"), "api_key")
  assert.equal(connectionBadgeFor("anthropic"), "api_key")
})

test("buildProvidersScreenModel: UI rows never expose secret fields", () => {
  const model = buildProvidersScreenModel([provider({ id: "beatapi", name: "BeatAPI" })])
  const forbidden = new Set(["apiKey", "api_key", "token", "accessToken", "secret", "password", "credential"])
  for (const row of [...model.connected, ...model.popular, model.custom]) {
    for (const key of Object.keys(row)) {
      assert.equal(forbidden.has(key), false, `unexpected secret-like field: ${key}`)
    }
  }
})

test("isFreeModel: zero or missing cost is free; positive cost is not", () => {
  assert.equal(isFreeModel(undefined), true)
  assert.equal(isFreeModel({ input: 0, output: 0 }), true)
  assert.equal(isFreeModel({ input: 1, output: 0 }), false)
})
