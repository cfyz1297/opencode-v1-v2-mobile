import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { runInNewContext } from "node:vm"
import {
  buildProvidersScreenModel,
  connectHref,
  CUSTOM_PROVIDER_ROUTE,
} from "./providers-ui.ts"
import { validateConnectProviderId } from "./provider-auth.ts"

const require = createRequire(import.meta.url)
const ts = require("typescript")

const root = fileURLToPath(new URL("../..", import.meta.url))

/** Render the real Providers screen against deterministic React Native adapters. */
function renderScreen() {
  const routes: string[] = []
  const devices = [
    { id: "opencode-go", name: "OpenCode Go", connected: true, models: [{ id: "m", name: "M" }] },
    // Not in POPULAR_PROVIDERS: the generic change-key path this change adds.
    { id: "wafer.ai", name: "Wafer", connected: true, models: [{ id: "w", name: "W" }] },
  ]
  const catalogState = { providers: devices, load: async () => {} }
  const jsx = (type: unknown, props: unknown) => ({ type, props })
  const modules: Record<string, unknown> = {
    react: {
      useCallback: (value: unknown) => value,
      useMemo: (value: () => unknown) => value(),
      useState: (initial: unknown) => [initial, () => {}],
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      View: "View",
      Text: "Text",
      ScrollView: "ScrollView",
      TouchableOpacity: "TouchableOpacity",
      RefreshControl: "RefreshControl",
      TextInput: "TextInput",
      StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
      useColorScheme: () => "light",
    },
    "expo-router": {
      Stack: { Screen: "StackScreen" },
      router: { push: (url: string) => routes.push(url) },
    },
    "react-i18next": { useTranslation: () => ({ t: (key: string) => key }) },
    "../../src/stores/catalog": { useCatalog: (select: (s: unknown) => unknown) => select(catalogState) },
    "../../src/stores/connections": {
      useConnections: (select: (s: unknown) => unknown) => select({ client: { id: "client" } }),
    },
    "../../src/lib/providers-ui": {
      buildProvidersScreenModel,
      connectHref,
      CUSTOM_PROVIDER_ROUTE,
    },
  }
  const source = readFileSync(`${root}app/providers/index.tsx`, "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports: Record<string, any> = {}
  runInNewContext(output, {
    exports,
    require: (id: string) => {
      if (!(id in modules)) throw new Error(`Unexpected dependency ${id}`)
      return modules[id]
    },
  })
  return { tree: exports.default(), routes }
}

function walk(node: unknown, visit: (node: any) => void) {
  if (!node || typeof node !== "object") return
  visit(node)
  const children = (node as { props?: { children?: unknown } }).props?.children
  for (const child of Array.isArray(children) ? children.flat(3) : [children]) walk(child, visit)
}

function findByTestID(tree: unknown, testID: string) {
  let found: any = null
  walk(tree, (node) => {
    if (node.props?.testID === testID) found = node
  })
  return found
}

function texts(tree: unknown): string[] {
  const found: string[] = []
  walk(tree, (node) => {
    if (node.type !== "Text") return
    const children = node.props?.children
    const value = Array.isArray(children) ? children.join("") : children
    if (typeof value === "string") found.push(value)
  })
  return found
}

test("tapping a connected provider opens the connect screen so its key can be replaced", () => {
  const { tree, routes } = renderScreen()
  const row = findByTestID(tree, "provider-connected-opencode-go")

  assert.ok(row, "connected provider row is rendered")
  assert.equal(row.type, "TouchableOpacity", "connected provider row must be pressable")
  assert.equal(typeof row.props.onPress, "function")
  assert.ok(texts(row).includes("providers.connectedEditCta"), "row shows the replace-key action")

  row.props.onPress()
  assert.deepEqual(routes, [connectHref("opencode-go")])
})

test("a catalog id outside POPULAR_PROVIDERS reaches a connect screen that accepts it", () => {
  const { tree, routes } = renderScreen()
  const row = findByTestID(tree, "provider-connected-wafer.ai")

  assert.ok(row, "dotted provider id still renders a row")
  row.props.onPress()

  const pushed = new URL(routes[0], "http://x").searchParams.get("id")
  assert.equal(pushed, "wafer.ai")
  // The dead end this change removes: an id the connect screen rejects leaves
  // its submit button permanently disabled.
  assert.deepEqual(validateConnectProviderId(pushed), { ok: true, id: "wafer.ai" })
})
