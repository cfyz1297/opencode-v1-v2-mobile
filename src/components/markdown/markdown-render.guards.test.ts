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

// Links in chat were inert on Android (upstream #284): the library's link()
// renders a selectable Text whose press is swallowed by the surrounding list
// row, a URL in backticks is a codespan with no press at all, and plain user
// messages have no markdown pass to begin with. The contract is pinned here
// because node:test has no React Native renderer.
test("the renderer owns link presses and no press is behind canOpenURL", () => {
  assert.match(markdown, /  link\(/, "the renderer must override link()")
  const start = markdown.indexOf("  link(")
  const override = markdown.slice(start, markdown.indexOf("  strong(", start))
  assert.match(override, /onPress=/, "the press must be ours")
  assert.match(override, /openLink\(/, "the press goes through the shared opener")
  assert.doesNotMatch(override, /selectable/, "selectable Text in a FlatList row swallows the press on Android")

  // canOpenURL is filtered by the manifest's <queries> on Android 11+, and the
  // Expo template declares only https — every http URL would refuse to open.
  const opener = readFileSync(new URL("./open-link.ts", import.meta.url), "utf8")
  assert.doesNotMatch(opener.replace(/\/\/.*$/gm, ""), /canOpenURL\(/, "an activity start is not visibility-filtered; the guard only broke http")
  assert.match(opener, /openURL\([^)]*\)\.catch\(/, "a failed open must offer Copy, not fail silently")
  // A model-written markdown href can be any `scheme:`; react-native-marked
  // passes all of them through, and RN's Android sink starts an activity for
  // any of them. The allowlist is the only control, so its call is pinned.
  assert.match(opener, /isAllowedLinkScheme\(url\)/, "every press must pass the scheme allowlist")
})

test("an image inside a link cannot bypass the scheme allowlist", () => {
  // [![alt](img)](href) parses as a link whose child is an image, and the
  // parser calls linkImage() — not link(). The library's own linkImage wraps
  // the image in onLinkPress, a raw Linking.openURL that never sees the
  // allowlist, so one markdown line would still launch any intent.
  assert.match(markdown, /  linkImage\(/, "linkImage must be overridden")
  const start = markdown.indexOf("  linkImage(")
  const override = markdown.slice(start, markdown.indexOf("  image(", start))
  assert.match(override, /openLink\(href\)/, "the image's press goes through the same opener")
  assert.doesNotMatch(override, /onLinkPress/, "the library's raw openURL must not be used")
})

test("a link is never wrapped in selectable text, which would swallow the tap", () => {
  // Bold/italic/strikethrough/headings wrap their children in plainText; a
  // link inside them is a nested onPress that selectable text never delivers.
  assert.match(markdown, /selectable=\{!hasLink\(children\)\}/, "plainText must opt out of selection when it wraps a link")
})

test("URLs are linkified in plain text, backticks and user messages", () => {
  assert.match(markdown, /splitTextWithUrls/, "text() must linkify bare URLs autolink missed")
  assert.match(markdown, /extractSingleUrl/, "a codespan that is one URL must render as a link")
  assert.match(markdown, /new CustomRenderer\(theme\.text, theme\.link\)/, "the link style comes from the theme")
  const bubble = readFileSync(new URL("../chat/MessageBubble.tsx", import.meta.url), "utf8")
  assert.match(bubble, /<LinkifiedText/, "user text has no markdown pass; it must be linkified explicitly")
  assert.match(bubble, /from "\.\.\/markdown"/, "through the shared markdown exports")
  // Our own link nodes get the paragraph's metrics too, or a linked word in a
  // heading renders at body size (the header comment's rule).
  assert.match(markdown, /this\.link\(segment\.text, segment\.url, \[this\.base, styles, this\.linkStyle\]\)/)
})
