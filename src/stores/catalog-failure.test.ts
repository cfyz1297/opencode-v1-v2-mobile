// A provider fetch that fails must not erase the catalog. The model and
// reasoning-effort pickers read `providers` straight from this store, so a
// null answer (server asleep, phone just unlocked, timeout) used to blank both
// sheets until the user happened to open Settings → Models, which calls
// load() again.
//
// The store can't be imported directly here: catalog.ts pulls in expo/zustand
// modules that do not resolve under node:test. Transpile it against a stub
// module registry instead — the same harness src/lib/settings-persistence.test.ts
// uses.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { runInNewContext } from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")

function fakeClient(providerList: () => Promise<unknown>) {
  return {
    agent: { list: async () => [{ id: "build", name: "Build" }] },
    command: { list: async () => [] },
    provider: { list: providerList },
  }
}

function freshCatalog(providerList: () => Promise<unknown>) {
  const source = readFileSync(fileURLToPath(new URL("./catalog.ts", import.meta.url).href), "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText

  // The connection between loads: the same server (a resume refresh) or a
  // different one (the user switched servers).
  const state = { client: fakeClient(providerList), id: "conn-1" }

  const modules: Record<string, unknown> = {
    zustand: {
      create: (initializer: (set: unknown, get: unknown) => unknown) => {
        let store = initializer(
          (partial: unknown) =>
            (store = { ...(store as object), ...(typeof partial === "function" ? partial(store) : partial) }),
          () => store,
        )
        return Object.assign(() => store, { getState: () => store })
      },
    },
    "./connections": {
      useConnections: { getState: () => ({ client: state.client, activeConnection: { id: state.id } }) },
    },
    "../lib/model-selection": { chooseModelSelection: ({ existing }: { existing: unknown }) => existing },
    "../lib/providers-ui": { isFreeModel: () => false },
  }

  const exports: Record<string, any> = {}
  runInNewContext(output, {
    exports,
    module: { exports },
    require: (id: string) => {
      if (!(id in modules)) throw new Error(`Unexpected dependency ${id}`)
      return modules[id]
    },
  })
  return { catalog: exports.useCatalog, state }
}

const oneProvider = {
  all: [{ id: "p", name: "Provider", models: { m: { id: "m", name: "Model" } } }],
  connected: ["p"],
  default: { p: "m" },
}

async function failingNetwork() {
  throw new Error("network down")
}

test("a failed provider fetch keeps the catalog the pickers are showing", async () => {
  let answer: () => Promise<unknown> = async () => oneProvider
  const { catalog } = freshCatalog(() => answer())

  await catalog.getState().load()
  assert.deepEqual(catalog.getState().providers.map((p: { id: string }) => p.id), ["p"])
  const model = catalog.getState().model

  answer = failingNetwork
  await catalog.getState().load()

  assert.deepEqual(
    catalog.getState().providers.map((p: { id: string }) => p.id),
    ["p"],
    "providers must survive a failed refresh",
  )
  assert.deepEqual(catalog.getState().model, model, "the selected model must survive too")
})

test("a failed first fetch leaves an empty catalog without throwing", async () => {
  const { catalog } = freshCatalog(failingNetwork)
  await catalog.getState().load()
  assert.equal(catalog.getState().providers.length, 0)
  assert.equal(catalog.getState().loaded, true)
})

test("a failed fetch on another connection does not inherit the old server's models", async () => {
  const { catalog, state } = freshCatalog(async () => oneProvider)
  await catalog.getState().load()
  assert.equal(catalog.getState().providers.length, 1)

  // The user switched to a second server, and that server is unreachable.
  state.id = "conn-2"
  state.client = fakeClient(failingNetwork)
  await catalog.getState().load()

  assert.equal(catalog.getState().providers.length, 0, "first server's models must not leak to the second")
})
