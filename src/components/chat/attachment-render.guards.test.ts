// The composer can attach any file, not photos only. Two places used to drop
// those silently: the transcript filtered file parts down to image/*, so a
// sent .txt/.pdf disappeared from history, and the preview rendered every
// attachment as a photo thumbnail. node:test has no React Native renderer, so
// the branches are pinned against the sources.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const bubble = readFileSync(new URL("./MessageBubble.tsx", import.meta.url), "utf8")
const strip = readFileSync(new URL("./Attachments.tsx", import.meta.url), "utf8")

test("the transcript keeps every file part, not only images", () => {
  assert.match(bubble, /parts\.filter\(\(p\) => p\.type === "file"\)/, "non-image file parts must reach the bubble")
  assert.doesNotMatch(bubble, /p\.type === "file" && isImageMime/, "an image-only filter hides sent documents")
})

test("a non-image attachment renders as a document chip, never as an <Image>", () => {
  const start = bubble.indexOf("isImageMime(fp.mime)")
  const branch = bubble.slice(start, start + 900)
  assert.ok(start > 0, "the bubble must branch on the file's mime")
  assert.match(branch, /fileChip/, "documents get a chip")
  assert.match(strip, /isImageMime\(att\.mime\)/, "the preview must branch too")
  assert.match(strip, /document-text-outline/, "and show a document tile instead of a thumbnail")
})
