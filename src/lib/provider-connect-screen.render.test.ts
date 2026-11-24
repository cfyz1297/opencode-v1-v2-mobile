import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { runInNewContext } from "node:vm"
import {
  canonicalConnectProviderId,
  resolveConnectDisplayName,
  validateApiKeyInput,
  validateConnectProviderId,
} from "./provider-auth.ts"
import { findPopularProvider, POPULAR_PROVIDERS } from "./providers-ui.ts"

const require = createRequire(import.meta.url)
const ts = require("typescript")

const root = fileURLToPath(new URL("../..", import.meta.url))

const source = readFileSync(`${root}app/providers/connect.tsx`, "utf8")
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText

/**
 * Render the real connect screen with a miniature hook runtime, so the test
 * checks what the screen shows and submits rather than grepping its source.
 */
function renderConnect(params: { id?: string; name?: string }, providers: Array<{ id: string; name: string }> = []) {
  let currentParams = params
  const state: unknown[] = []
  const written: Array<[string, string]> = []
  const alerts: string[] = []
  let titles: string[] = []
  let leadArgs: Array<Record<string, string>> = []
  let passTitles: string[] = []
  let passLead: Array<Record<string, string>> = []
  let tree: any

  const t = (key: string, opts?: Record<string, string>) => {
    if (key === "providers.connect.title" && opts) passTitles.push(opts.name)
    if (key === "providers.connect.lead" && opts) passLead.push(opts)
    if (key === "providers.connect.success" && opts) alerts.push(`success:${opts.name}`)
    return key
  }

  const jsx = (type: unknown, props: unknown) => ({ type, props })
  let hookIndex = 0
  const modules: Record<string, unknown> = {
    react: {
      useCallback: (fn: unknown) => fn,
      useMemo: (fn: () => unknown) => fn(),
      useState: (initial: unknown) => {
        const index = hookIndex++
        if (!(index in state)) state[index] = initial
        return [state[index], (next: unknown) => { state[index] = next }]
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      View: "View",
      Text: "Text",
      ScrollView: "ScrollView",
      TextInput: "TextInput",
      TouchableOpacity: "TouchableOpacity",
      ActivityIndicator: "ActivityIndicator",
      StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
      useColorScheme: () => "light",
      Alert: { alert: () => {} },
    },
    "expo-router": {
      Stack: { Screen: "StackScreen" },
      router: { back: () => {}, push: () => {} },
      useLocalSearchParams: () => currentParams,
    },
    "react-i18next": { useTranslation: () => ({ t }) },
    "../../src/stores/connections": {
      useConnections: (select: (s: unknown) => unknown) =>
        select({
          client: {
            provider: {
              connectApiKey: async (id: string, key: string) => {
                written.push([id, key])
              },
            },
          },
        }),
    },
    "../../src/stores/catalog": {
      useCatalog: (select: (s: unknown) => unknown) => select({ providers, load: async () => {} }),
    },
    "../../src/lib/providers-ui": { findPopularProvider, POPULAR_PROVIDERS },
    "../../src/lib/provider-auth": {
      canonicalConnectProviderId,
      resolveConnectDisplayName,
      validateApiKeyInput,
      validateConnectProviderId,
    },
    "../../src/lib/sdk": {
      ApiError: class ApiError extends Error {
        status = 0
      },
      isAuthError: () => false,
    },
  }

  const exports: Record<string, any> = {}
  runInNewContext(compiled, {
    exports,
    require: (id: string) => {
      if (!(id in modules)) throw new Error(`Unexpected dependency ${id}`)
      return modules[id]
    },
  })

  /** Render the screen; no effects remain, so one pass is enough. */
  function render() {
    hookIndex = 0
    passTitles = []
    passLead = []
    tree = exports.default()
    titles = passTitles
    leadArgs = passLead
    return tree
  }

  function find(node: unknown, testID: string): any {
    if (!node || typeof node !== "object") return null
    const candidate = node as { props?: Record<string, any> }
    if (candidate.props?.testID === testID) return candidate
    const children = candidate.props?.children
    for (const child of Array.isArray(children) ? children.flat(3) : [children]) {
      const found = find(child, testID)
      if (found) return found
    }
    return null
  }

  return {
    render,
    find,
    titles: () => titles,
    leadArgs: () => leadArgs,
    written,
    alerts,
    retarget(next: { id?: string; name?: string }) {
      currentParams = next
    },
    typeKey(key: string) {
      find(render(), "provider-connect-key").props.onChangeText(key)
      render()
    },
    async pressSubmit() {
      find(render(), "provider-connect-submit").props.onPress()
      for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve))
      render()
    },
  }
}

test("a ?name= label on the deep link never reaches the screen or the write", async () => {
  // The catalog holds only connected providers, so an unconnected id used to
  // take its name from the query: "OpenAI" over a write to wafer.ai.
  const ui = renderConnect({ id: "wafer.ai", name: "OpenAI" })
  ui.typeKey("sk-test-1234")

  assert.deepEqual(ui.titles(), ["wafer.ai"], "title names the id being written")
  assert.deepEqual({ ...ui.leadArgs()[0] }, { name: "wafer.ai", id: "wafer.ai" })

  await ui.pressSubmit()
  assert.deepEqual(ui.written, [["wafer.ai", "sk-test-1234"]])
  assert.deepEqual(ui.alerts, ["success:wafer.ai"], "success names the provider written")
})

test("a connected provider is shown by its catalog name", () => {
  const ui = renderConnect({ id: "wafer.ai" }, [{ id: "wafer.ai", name: "Wafer" }])
  ui.render()

  assert.deepEqual(ui.titles(), ["Wafer"])
  assert.deepEqual({ ...ui.leadArgs()[0] }, { name: "Wafer", id: "wafer.ai" })
})

test("a case variant is written to the catalog id it is shown as", async () => {
  assert.equal(
    canonicalConnectProviderId("Anthropic", POPULAR_PROVIDERS.map((p) => p.id)),
    "anthropic",
    "helper works outside the screen",
  )
  const ui = renderConnect({ id: "Anthropic" })
  ui.typeKey("sk-test-1234")

  assert.deepEqual(ui.titles(), ["Anthropic"], "known id is shown by its brand")
  assert.equal(ui.leadArgs()[0].name, "Anthropic")
  assert.equal(ui.leadArgs()[0].id, "anthropic", "and written under the catalog id")
  await ui.pressSubmit()
  assert.deepEqual(ui.written, [["anthropic", "sk-test-1234"]])
})

test("a second deep link cannot submit the key typed for the first provider", async () => {
  const ui = renderConnect({ id: "anthropic" })
  ui.typeKey("sk-test-1234")

  ui.retarget({ id: "openai" })
  ui.render()
  assert.deepEqual(ui.titles(), ["OpenAI"], "screen retargeted to the new provider")
  assert.equal(ui.find(ui.render(), "provider-connect-key").props.value, "", "field emptied on the same render")

  await ui.pressSubmit()
  // The draft belongs to the id it was typed for, so the anthropic key is
  // never written to openai.
  assert.deepEqual(ui.written, [])
})

test("an invalid id shows its error instead of silently disabling submit", () => {
  const ui = renderConnect({ id: "a/b" })
  ui.render()

  assert.ok(ui.find(ui.render(), "provider-connect-id-error"), "id error is rendered")
})
