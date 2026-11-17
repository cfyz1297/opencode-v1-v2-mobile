// Guards for the two upstream crash fixes we took in 0.3.30 (v0.4.22 / v0.4.23:
// issues #255 and #262). Both are chains through react-native-marked, and both
// start from code we run:
//
//   MDImage fetches its size in an effect with no dependency array
//     → unbounded re-render loop for any markdown image (#262)
//     → each render asks the memoized renderer for fresh keys
//     → the base Renderer keys come from github-slugger, one property per call
//     → at 196,607 properties Hermes throws and the session screen dies (#255)
//
// node:test has no React Native renderer, so the contract is pinned against the
// sources: the renderer's key source, our image override, and the installed
// library version that still needs the override.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const markdown = readFileSync(new URL("./Markdown.tsx", import.meta.url), "utf8")
const image = readFileSync(new URL("./MarkdownImage.tsx", import.meta.url), "utf8")
const library = require.resolve("react-native-marked/src/components/MDImage.tsx", {
  paths: [process.cwd()],
})

test("React keys no longer come from the slugger", () => {
  // The library's getKey() is `slugger.slug(prefix)`: one new property per
  // call, forever, on a renderer that outlives re-renders.
  assert.match(markdown, /getKey\(\): string \{/, "the renderer must override getKey")
  const override = markdown.slice(markdown.indexOf("getKey()"), markdown.indexOf("getKey()") + 260)
  assert.match(override, /this\.key\(\)|createMarkdownKeys/, "keys must come from a counter")
  assert.doesNotMatch(override, /slugger|this\.slugPrefix/, "the slugger must not be used for keys")
})

test("markdown images render through the app's own component", () => {
  // The library's MDImage loops; ours scopes the fetch to the URI.
  assert.match(markdown, /image\(/, "the renderer must override image()")
  const override = markdown.slice(markdown.indexOf("  image("), markdown.indexOf("  image(") + 700)
  assert.match(override, /MarkdownImage/, "non-SVG images go through our component")
  assert.match(override, /\.svg/, ".svg keeps the library's component, whose effect is already scoped")
})

test("the image size fetch runs once per URI", () => {
  assert.match(image, /useEffect\(/, "the component fetches its size")
  const start = image.indexOf("useEffect(")
  // Up to the closing dependency array, so the assertion cannot be defeated by
  // a longer body.
  const effect = image.slice(start, image.indexOf("}, [uri])", start) + 9)
  assert.ok(effect.length > 20, "the effect must exist in full")
  assert.match(effect, /\}, \[uri\]\)/, "the effect must depend on the URI only")
  assert.match(effect, /Image\.getSize\(/, "it resolves the real aspect ratio")
  assert.match(image, /memo\(/, "an unchanged URI must not re-run anything")
})

test("the installed library still needs both overrides", () => {
  // Canary: if a future react-native-marked scopes its effect, this test fails
  // and tells us the override can go — instead of it silently rotting.
  const source = readFileSync(library, "utf8")
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*fetchOriginalSizeFromRemoteImage\(\);\s*\}\)/,
    "MDImage's effect still has no dependency array — keep the override",
  )
})
