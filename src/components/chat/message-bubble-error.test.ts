import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { runInNewContext } from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")

// A failed run stores its reason on the assistant message (`info.error`) and
// leaves the bubble empty, so the chat looked like it had simply stopped
// answering (free-model 429s were the observed case). Render the real
// component with deterministic adapters and read the produced tree.

function component() {
  const jsx = (type: unknown, props: unknown) => ({ type, props })
  const modules: Record<string, unknown> = {
    react: {
      memo: (fn: unknown) => fn,
      useCallback: (fn: unknown) => fn,
      useEffect: () => {},
      useState: (initial: unknown) => [initial, () => {}],
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      View: "View",
      Text: "Text",
      Image: "Image",
      ScrollView: "ScrollView",
      TouchableOpacity: "TouchableOpacity",
      Dimensions: { get: () => ({ width: 400 }) },
      StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    },
    "expo-clipboard": { setStringAsync: async () => {} },
    "react-i18next": { useTranslation: () => ({ t: (key: string) => key }) },
    "@expo/vector-icons": { Ionicons: "Ionicons" },
    "../markdown": { Markdown: "Markdown" },
    "./ActivitySpoiler": { ActivitySpoiler: "ActivitySpoiler" },
    "./ToolCallCard": { ToolCallCard: "ToolCallCard" },
    "./CompactionCard": { CompactionCard: "CompactionCard" },
    "../../lib/part-runs": { groupParts: () => [] },
  }
  const output = ts.transpileModule(
    readFileSync(fileURLToPath(new URL("./MessageBubble.tsx", import.meta.url).href), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText
  const exports: Record<string, (props: unknown) => unknown> = {}
  runInNewContext(output, {
    exports,
    require: (id: string) => {
      if (!(id in modules)) throw new Error(`Unexpected dependency ${id}`)
      return modules[id]
    },
  })
  return exports.MessageBubble
}

function texts(tree: unknown, found: string[] = []): string[] {
  if (!tree || typeof tree !== "object") return found
  const node = tree as { type?: unknown; props?: { children?: unknown } }
  if (node.type === "Text") {
    for (const child of [node.props?.children].flat(Infinity) as unknown[]) {
      if (typeof child === "string" || typeof child === "number") found.push(String(child))
    }
  }
  for (const child of [node.props?.children].flat(Infinity) as unknown[]) texts(child, found)
  return found
}

const assistant = {
  id: "msg_1",
  sessionID: "ses_1",
  role: "assistant" as const,
  time: { created: 1, completed: 2 },
  modelID: "deepseek-v4.1-flash-free",
}

test("failed assistant message shows the server's reason instead of an empty bubble", () => {
  const reason =
    "Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models."
  const tree = component()({
    message: { ...assistant, error: { message: reason } },
    parts: [],
    isDark: true,
  })
  const rendered = texts(tree)
  assert.ok(
    rendered.some((line) => line.includes(reason)),
    `chat must render the failure reason, got: ${JSON.stringify(rendered)}`,
  )
})

test("successful assistant message has no failure row", () => {
  const tree = component()({
    message: assistant,
    parts: [{ id: "p1", messageID: "msg_1", type: "text", text: "Готово" }],
    isDark: true,
  })
  const rendered = texts(tree)
  assert.ok(!rendered.includes("chat.message.failed"), `successful run must not show a failure row: ${JSON.stringify(rendered)}`)
})

test("failed message without server text falls back to a translated label", () => {
  const tree = component()({
    message: { ...assistant, error: { message: "" } },
    parts: [],
    isDark: true,
  })
  assert.ok(texts(tree).includes("chat.message.failed"))
})
