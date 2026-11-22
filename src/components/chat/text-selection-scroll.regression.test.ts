// Android's ScrollView scrolls a child that takes focus into view, and a
// selectable <Text> takes focus on long-press — so holding a word in an answer
// yanked the transcript up or down (facebook/react-native#33440). The list
// turns that native behavior off; selection itself must stay enabled.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const sessionSource = readFileSync(new URL("../../../app/session/[id].tsx", import.meta.url), "utf8")
const bubbleSource = readFileSync(new URL("./MessageBubble.tsx", import.meta.url), "utf8")
const markdownSource = readFileSync(new URL("../markdown/Markdown.tsx", import.meta.url), "utf8")

test("the transcript does not scroll to a selectable text that takes focus", () => {
  const listStart = sessionSource.lastIndexOf("<FlatList")
  assert.ok(listStart >= 0, "the session screen must render a FlatList")
  const listTag = sessionSource.slice(listStart, sessionSource.indexOf("renderItem", listStart))
  assert.match(listTag, /scrollsChildToFocus=\{false\}/, "Android scrolls the long-pressed <Text> into view without it")
})

test("long-press selection stays available on assistant text", () => {
  assert.match(markdownSource, /selectable=\{!hasLink\(children\)\}/, "markdown text nodes stay selectable unless they wrap a link")
  // User text keeps selection too — LinkifiedText drops it only for text that
  // actually contains a URL, where selectable would swallow the tap.
  assert.match(bubbleSource, /<LinkifiedText[\s\S]{0,120}selectable /, "user text stays selectable when it has no link")
  assert.match(
    readFileSync(new URL("../markdown/LinkifiedText.tsx", import.meta.url), "utf8"),
    /segments\.some\(\(segment\) => segment\.url\)/,
    "the link branch decides selection",
  )
})
