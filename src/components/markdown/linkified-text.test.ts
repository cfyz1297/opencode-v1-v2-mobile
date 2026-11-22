import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { runInNewContext } from "node:vm"
import { splitTextWithUrls } from "../../lib/linkify.ts"

const require = createRequire(import.meta.url)
const ts = require("typescript")

// The real component, rendered with deterministic adapters: node:test has no
// React Native renderer, and a source grep cannot prove that the link node is
// pressable — deleting onPress would leave every grep green (upstream #284).

interface Node {
  type: unknown
  props: Record<string, unknown>
}

function render(text: string, selectable?: boolean): Node {
  const jsx = (type: unknown, props: unknown) => ({ type, props }) as Node
  const opened: string[] = []
  const modules: Record<string, unknown> = {
    react: { memo: (fn: unknown) => fn },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Text: "Text" },
    "../../lib/linkify": { splitTextWithUrls },
    "../../lib/i18n/config": { __esModule: true, default: { t: (key: string) => key } },
    "./link-color": { LINK_COLOR: { light: "#111111", dark: "#eeeeee" } },
    "./open-link": { openLink: (url: string) => opened.push(url) },
  }
  const output = ts.transpileModule(
    readFileSync(fileURLToPath(new URL("./LinkifiedText.tsx", import.meta.url).href), "utf8"),
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
  const tree = exports.LinkifiedText({ text, selectable, isDark: false }) as Node
  return { ...tree, props: { ...tree.props, opened } }
}

// Depth-first walk, collecting every node.
function nodes(tree: unknown, found: Node[] = []): Node[] {
  if (!tree || typeof tree !== "object") return found
  const node = tree as Node
  if (node.type) found.push(node)
  for (const child of [node.props?.children].flat(Infinity) as unknown[]) nodes(child, found)
  return found
}

test("a URL inside user text is pressable and opens", () => {
  const tree = render("docs at https://example.com/x please")
  const link = nodes(tree).find((node) => node.props.accessibilityRole === "link")
  assert.ok(link, "the URL must render as a link node")
  assert.equal(typeof link.props.onPress, "function", "a link without a press is the bug this fixes")
  ;(link.props.onPress as () => void)()
  assert.deepEqual(tree.props.opened, ["https://example.com/x"])
})

test("the link branch drops selection, so the tap is not swallowed", () => {
  const withLink = render("https://example.com/x", true)
  const outer = nodes(withLink).find((node) => node.type === "Text" && node.props.children !== undefined)
  assert.ok(outer)
  assert.notEqual(outer.props.selectable, true, "selectable text handles the touch itself on Android")

  // Text without a link keeps selection: copying a phrase is a common need.
  const plain = render("no links here", true)
  assert.equal(plain.props.selectable, true)
})

test("text without a link renders as one plain node", () => {
  const tree = render("plain sentence")
  assert.equal(tree.props.children, "plain sentence")
  assert.equal(nodes(tree).some((node) => node.props.accessibilityRole === "link"), false)
})
