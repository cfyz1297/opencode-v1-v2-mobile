import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from "node:url"
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { buildModelPickerSections } from './model-picker-filter.ts'
import { createModelVisibility, modelKey } from './model-visibility.ts'

const require = createRequire(import.meta.url)
const ts = require('typescript')

/** Run the actual screen with minimal deterministic native/hooks adapters. */
function screen() {
  const states: unknown[] = []
  let cursor = 0
  let mounted = false
  const effects: Array<() => void> = []
  const alerts: unknown[][] = []
  const routes: string[] = []
  const client = {}
  const connections = { client, activeConnection: { id: 's' } }
  const catalog = { catalogClient: client, catalogConnection: 's', loaded: true, providers: [{ id: 'go', name: 'OpenCode Go', models: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }] }], load: async () => {} }
  let fail = false
  const preferences = {
    loaded: true, error: false, entries: [] as Array<[string, string[]]>, load: async () => {},
    setEnabled: async (scope: string, provider: string, model: string, enabled: boolean) => {
      if (fail) throw new Error('storage')
      preferences.entries = [[scope, enabled ? [] : [modelKey(provider, model)]]]
    },
  }
  const hook = <T,>(get: () => T) => Object.assign((select: (state: T) => unknown) => select(get()), { getState: get })
  const react = {
    useCallback: (value: unknown) => value,
    useMemo: (value: () => unknown) => value(),
    useState: (initial?: unknown) => {
      const index = cursor++
      if (!mounted) states[index] = initial
      return [states[index], (value: unknown) => { states[index] = value }]
    },
    useEffect: (effect: () => void) => { if (!mounted) effects.push(effect) },
  }
  const jsx = (type: unknown, props: unknown) => ({ type, props })
  const modules: Record<string, unknown> = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Alert: { alert: (...args: unknown[]) => alerts.push(args) }, View: 'View', Text: 'Text', TextInput: 'TextInput', SectionList: 'SectionList', Switch: 'Switch', TouchableOpacity: 'TouchableOpacity', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (v: unknown) => v, hairlineWidth: 1 }, useColorScheme: () => 'dark' },
    'expo-router': { Stack: { Screen: 'Screen' }, router: { push: (url: string) => routes.push(url) }, useFocusEffect: react.useEffect },
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    '../src/stores/catalog': { useCatalog: hook(() => catalog) },
    '../src/stores/connections': { useConnections: hook(() => connections) },
    '../src/stores/model-visibility': { useModelVisibility: () => preferences },
    '../src/lib/model-visibility': { modelKey },
    '../src/lib/model-picker-filter': { buildModelPickerSections },
    '../src/lib/providers-ui': { PROVIDERS_ROUTE: '/providers' },
  }
  const output = ts.transpileModule(readFileSync(fileURLToPath(new URL('../../app/models.tsx', import.meta.url).href), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports: Record<string, () => unknown> = {}
  runInNewContext(output, { exports, require: (id: string) => { if (!(id in modules)) throw new Error(`Unexpected dependency ${id}`); return modules[id] } })
  const render = () => { cursor = 0; const tree = exports.default(); mounted = true; return tree }
  return { render, effects, alerts, routes, preferences, catalog, connections, failWrites: () => { fail = true } }
}

function find(tree: unknown, type: string): any {
  if (!tree || typeof tree !== 'object') return null
  const node = tree as { type?: string; props?: { children?: unknown } }
  if (node.type === type) return node
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children.flat() : [children]) {
    const found = find(child, type)
    if (found) return found
  }
  return null
}

test('actual Models screen loads provider groups, toggles a model, and searches', async () => {
  const app = screen()
  app.render()
  app.effects.forEach(effect => effect())
  await new Promise(resolve => setImmediate(resolve))
  let tree = app.render()
  let list = find(tree, 'SectionList').props
  assert.equal(list.sections[0].title, 'OpenCode Go')
  const row = list.renderItem({ item: list.sections[0].data[0] })
  assert.equal(find(row, 'Switch').props.value, true)
  find(row, 'Switch').props.onValueChange(false)
  await new Promise(resolve => setImmediate(resolve))
  tree = app.render()
  list = find(tree, 'SectionList').props
  assert.equal(find(list.renderItem({ item: list.sections[0].data[0] }), 'Switch').props.value, false)
  find(tree, 'TextInput').props.onChangeText('beta')
  list = find(app.render(), 'SectionList').props
  assert.equal(list.sections[0].data[0].modelID, 'b')
  assert.equal(list.sections[0].data.length, 1)
})

test('actual Models screen shows storage error and keeps switch enabled on failure', async () => {
  const app = screen()
  app.render()
  app.effects.forEach(effect => effect())
  await new Promise(resolve => setImmediate(resolve))
  app.failWrites()
  const list = find(app.render(), 'SectionList').props
  find(list.renderItem({ item: list.sections[0].data[0] }), 'Switch').props.onValueChange(false)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(app.alerts, [['common.error', 'models.saveError']])
  assert.deepEqual(app.preferences.entries, [])
})

test('actual Models screen hides catalog when connection changes or disconnects', async () => {
  const app = screen()
  app.render()
  app.effects.forEach(effect => effect())
  await new Promise(resolve => setImmediate(resolve))
  app.connections.activeConnection.id = 'another-server'
  assert.equal(find(app.render(), 'SectionList').props.sections.length, 0)
})

test('catalog ignores pending responses after server connection changes', async () => {
  let complete: (value: unknown) => void = () => {}
  const pending = new Promise(resolve => { complete = resolve })
  let client: unknown = { agent: { list: async () => [] }, command: { list: async () => [] }, provider: { list: () => pending } }
  let state: Record<string, any>
  const original = { providers: [{ id: 'existing' }] }
  const modules: Record<string, unknown> = {
    zustand: { create: (initialize: (set: (value: unknown) => void, get: () => unknown) => Record<string, unknown>) => {
      state = initialize(value => { Object.assign(state, typeof value === 'function' ? value(state) : value) }, () => state)
      return state
    } },
    './connections': { useConnections: { getState: () => ({ client }) } },
    '../lib/model-selection': { chooseModelSelection: () => null },
    '../lib/providers-ui': { isFreeModel: () => false },
  }
  const output = ts.transpileModule(readFileSync(fileURLToPath(new URL('../stores/catalog.ts', import.meta.url).href), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports: Record<string, any> = {}
  runInNewContext(output, { exports, require: (id: string) => { if (!(id in modules)) throw new Error(id); return modules[id] } })
  Object.assign(exports.useCatalog, original)
  const loading = exports.useCatalog.load()
  client = {}
  complete({ all: [], connected: [] })
  await loading
  assert.equal(exports.useCatalog.providers, original.providers)
})

test('Models screen hides old models when client is replaced under the same connection id', async () => {
  const app = screen()
  app.render()
  app.effects.forEach(effect => effect())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(find(app.render(), 'SectionList').props.sections.length, 1)
  app.connections.client = {}
  assert.equal(find(app.render(), 'SectionList').props.sections.length, 0)
})

test('shared visibility hook gates both pickers until catalog belongs to the active client', async () => {
  const clientA = {}, clientB = {}
  const connection = { client: clientA, activeConnection: { id: 'a' } }
  const catalog = { catalogClient: clientA, catalogConnection: 'a' }
  const storage = { getItem: async () => null, setItem: async () => {} }
  const selector = <T,>(state: T) => (select: (s: T) => unknown) => select(state)
  const modules: Record<string, unknown> = {
    react: { useEffect: () => {} },
    zustand: { create: (initialize: (set: (value: unknown) => void) => Record<string, any>) => {
      let state: Record<string, any>
      state = initialize(value => Object.assign(state, value))
      return Object.assign(selector(state), { getState: () => state })
    } },
    '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
    '../lib/model-visibility': { createModelVisibility },
    './connections': { useConnections: selector(connection) },
    './catalog': { useCatalog: selector(catalog) },
  }
  const output = ts.transpileModule(readFileSync(fileURLToPath(new URL('../stores/model-visibility.ts', import.meta.url).href), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports: Record<string, any> = {}
  runInNewContext(output, { exports, require: (id: string) => { if (!(id in modules)) throw new Error(id); return modules[id] } })
  await exports.useModelVisibility.getState().load()
  await exports.useModelVisibility.getState().setEnabled('a', 'go', 'a', false)
  assert.equal(exports.useHiddenModels().loaded, true)
  connection.client = clientB
  connection.activeConnection.id = 'b'
  assert.equal(exports.useHiddenModels().loaded, false)
  catalog.catalogClient = clientB
  catalog.catalogConnection = 'b'
  assert.equal(exports.useHiddenModels().loaded, true)
  assert.equal(exports.useHiddenModels().hidden.length, 0)
  connection.client = clientA
  connection.activeConnection.id = 'a'
  assert.equal(exports.useHiddenModels().loaded, false)
  catalog.catalogClient = clientA
  catalog.catalogConnection = 'a'
  assert.deepEqual(exports.useHiddenModels().hidden, [modelKey('go', 'a')])
})
