// "The last line of a message is cut in half" — Android, device font only.
//
// React Native implements lineHeight with CustomLineHeightSpan
// (node_modules/react-native/ReactAndroid/.../internal/span/CustomLineHeightSpan.kt):
//
//   if (end == text.length) { fm.bottom = fm.descent }
//
// On the last line of a text block it pins the bottom of the line box to the
// font's reported descent. A font whose glyphs reach below that descent — any
// font but the emulator's Roboto, e.g. a themed system font — has the bottom of
// the last line clipped, while interior lines merely overlap and look fine.
// That is why the cut always lands on a paragraph's final line and never
// reproduced on the emulator.
//
// The only device-independent fix is not to override line spacing: without
// lineHeight no span is installed and Android derives the box from real font
// metrics (with includeFontPadding, which RN leaves on).
//
// The renderer is JSX, which this repo's node tests cannot import, so the
// invariant is pinned on the source, like chat-list-clipping.test.ts.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (file: string) => readFileSync(path.join(root, file), "utf8")

test("the markdown theme does not override line spacing", () => {
  const source = read("src/components/markdown/Markdown.tsx")
  const theme = source.slice(source.indexOf("const lightTheme"), source.indexOf("const darkTheme"))
  assert.doesNotMatch(theme, /lineHeight:/, "a lineHeight here clips the last line on device fonts")
})

test("message body text does not override line spacing either", () => {
  const source = read("src/components/chat/MessageBubble.tsx")
  const style = source.match(/messageText: \{([^}]*)\}/)?.[1] ?? ""
  assert.ok(style.includes("fontSize"), "messageText still exists")
  assert.doesNotMatch(style, /lineHeight/, "a lineHeight here clips the last line on device fonts")
})

test("every markdown Text is laid out with the paragraph's metrics", () => {
  // The parser builds a wrapper Text with no styles of its own; without the
  // base metrics it is measured at the platform default font instead.
  const source = read("src/components/markdown/Markdown.tsx")
  assert.match(source, /style=\{\[this\.base, styles\]\}/)
  const use = source.match(/new CustomRenderer\(([^)]*)\)/)
  assert.equal(use?.[1], "theme.text")
})
