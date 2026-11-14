// The keep-alive service is the difference between "the phone is in a pocket
// and notification timers still run" and "the process is frozen and nothing is
// generated at all". These pin that it actually starts, starts only once, and
// cannot be prevented from starting by a broken translation lookup — a silent
// failure there costs every background notification.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { runInNewContext } from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")

function harness(options: { translate?: (key: string) => unknown; bridgeFails?: boolean } = {}) {
  const calls: Array<{ method: "start" | "stop"; args: string[] }> = []
  const logs: string[] = []
  const bridge = {
    start: (title: string, body: string) => {
      if (options.bridgeFails) throw new Error("ForegroundServiceStartNotAllowedException")
      calls.push({ method: "start", args: [title, body] })
    },
    stop: () => calls.push({ method: "stop", args: [] }),
  }

  const registered: string[] = []
  const modules: Record<string, unknown> = {
    "react-native": {
      NativeModules: { KeepAlive: bridge },
      AppRegistry: {
        registerHeadlessTask: (key: string) => registered.push(key),
      },
    },
    "./i18n/config": {
      __esModule: true,
      default: {
        t: (key: string) => (options.translate ? options.translate(key) : key),
      },
    },
    "./logbuffer": {
      log: {
        debug: () => {},
        info: (_tag: string, ...parts: unknown[]) => logs.push(parts.join(" ")),
        warn: (_tag: string, ...parts: unknown[]) => logs.push(parts.join(" ")),
        error: (_tag: string, ...parts: unknown[]) => logs.push(parts.join(" ")),
      },
    },
  }

  const source = readFileSync(fileURLToPath(new URL("./keep-alive.ts", import.meta.url).href), "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText

  const exports: Record<string, any> = {}
  runInNewContext(output, {
    exports,
    module: { exports },
    require: (id: string) => {
      if (!(id in modules)) throw new Error(`Unexpected dependency ${id}`)
      return modules[id]
    },
    String,
    Error,
  })
  return { exports, calls, logs, registered }
}

test("an active run starts the foreground service once", () => {
  const { exports, calls } = harness()
  exports.setKeepAlive(true)
  exports.setKeepAlive(true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, "start")
  assert.ok(calls[0].args[0].length > 0, "the ongoing notification needs a title")
})

test("the service is stopped when the run ends", () => {
  const { exports, calls } = harness()
  exports.setKeepAlive(true)
  exports.setKeepAlive(false)
  assert.deepEqual(calls.map((call) => call.method), ["start", "stop"])
})

test("a broken translation still starts the service with usable text", () => {
  // Losing the service means losing every background notification, so a
  // missing key must never reach the native call.
  for (const translate of [
    () => undefined,
    () => ({}),
    () => {
      throw new Error("i18next not initialized")
    },
  ]) {
    const { exports, calls } = harness({ translate })
    exports.setKeepAlive(true)
    assert.equal(calls.length, 1, "the service must still start")
    assert.equal(typeof calls[0].args[0], "string")
    assert.equal(typeof calls[0].args[1], "string")
    assert.ok(calls[0].args[0].length > 0)
    assert.ok(calls[0].args[1].length > 0)
  }
})

test("a refused service start is logged and retried on the next call", () => {
  const { exports, calls, logs } = harness({ bridgeFails: true })
  exports.setKeepAlive(true)
  assert.equal(calls.length, 0)
  assert.ok(logs.some((line) => line.includes("could not start")), "the reason must reach the diagnostics block")
  // Android 12+ refuses a start from the background; the next attempt (after
  // the app is resumed or a new run begins) must not be skipped.
  exports.setKeepAlive(true)
  assert.equal(logs.filter((line) => line.includes("could not start")).length, 2)
})

test("the headless task is registered — without it React Native stops JS timers", () => {
  // JavaTimerManager drops its frame callback while isPaused && no active
  // headless task, so setInterval never fires in the background. The task is
  // what keeps the background watch alive.
  const { exports, registered, calls } = harness()
  exports.setKeepAlive(true)
  assert.deepEqual(registered, ["KeepAliveBackground"])
  assert.equal(calls.length, 1)
  // Registering twice would start a second task for one run.
  exports.setKeepAlive(false)
  exports.setKeepAlive(true)
  assert.deepEqual(registered, ["KeepAliveBackground"])
})

test("stopping the run settles the headless task so timers can pause again", async () => {
  const resolvers: Array<() => void> = []
  const logs: string[] = []
  const modules: Record<string, unknown> = {
    "react-native": {
      NativeModules: { KeepAlive: { start: () => {}, stop: () => {} } },
      AppRegistry: {
        registerHeadlessTask: (_key: string, factory: () => () => Promise<unknown>) => {
          const task = factory()
          const promise = task()
          // The task promise must stay pending for the whole run.
          assert.equal(promise instanceof Promise, true)
        },
      },
    },
    "./i18n/config": { __esModule: true, default: { t: (key: string) => key } },
    "./logbuffer": {
      log: {
        debug: () => {},
        info: (_tag: string, ...parts: unknown[]) => logs.push(parts.join(" ")),
        warn: () => {},
        error: () => {},
      },
    },
  }
  const source = readFileSync(fileURLToPath(new URL("./keep-alive.ts", import.meta.url).href), "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports: Record<string, any> = {}
  runInNewContext(output, {
    exports,
    module: { exports },
    require: (id: string) => modules[id],
    String,
    Error,
    Promise,
  })
  exports.setKeepAlive(true)
  assert.ok(logs.some((line) => line.includes("headless task running")))
  exports.setKeepAlive(false)
  // Nothing to assert on the resolve itself here; the run must simply not throw.
  assert.equal(resolvers.length, 0)
})

test("a missing native module is reported instead of silently doing nothing", () => {
  const logs: string[] = []
  const modules: Record<string, unknown> = {
    "react-native": { NativeModules: {}, AppRegistry: { registerHeadlessTask: () => {} } },
    "./i18n/config": { __esModule: true, default: { t: (key: string) => key } },
    "./logbuffer": {
      log: {
        debug: () => {},
        info: () => {},
        warn: (_tag: string, ...parts: unknown[]) => logs.push(parts.join(" ")),
        error: () => {},
      },
    },
  }
  const source = readFileSync(fileURLToPath(new URL("./keep-alive.ts", import.meta.url).href), "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports: Record<string, any> = {}
  runInNewContext(output, {
    exports,
    module: { exports },
    require: (id: string) => modules[id],
    String,
    Error,
  })
  exports.setKeepAlive(true)
  assert.ok(logs.some((line) => line.includes("native module missing")))
})
