import { test } from "node:test"
import assert from "node:assert/strict"
import { WIDE_CONTENT_SCROLL_CONFIG } from "./scroll-config.ts"

// GitHub issue #21: DiffView + CodeBlock must render wide content in a
// horizontally-scrollable container (not wrapped, not truncated). Both
// components spread WIDE_CONTENT_SCROLL_CONFIG onto their ScrollView (see
// src/components/chat/DiffView.tsx and src/components/markdown/CodeBlock.tsx)
// so asserting on this object here is asserting on the actual runtime props,
// not a parallel copy that can drift out of sync.

test("wide-content scroll config enables horizontal scrolling", () => {
  assert.equal(WIDE_CONTENT_SCROLL_CONFIG.horizontal, true)
})

test("wide-content scroll config shows the horizontal scroll indicator", () => {
  // Regression guard: a container that scrolls but hides its indicator is
  // easy to mistake for content that simply doesn't overflow. Keep the
  // indicator visible so on-device QA (and screenshots) can tell scrollable
  // content apart from clipped/truncated content.
  assert.equal(WIDE_CONTENT_SCROLL_CONFIG.showsHorizontalScrollIndicator, true)
})

test("wide-content scroll config hands the gesture to the nested scroller", () => {
  // Android: the chat is a vertical FlatList, and a horizontal ScrollView inside
  // it loses the gesture on the first vertical pixel of thumb drift unless the
  // nested scroller is allowed to take over.
  assert.equal(WIDE_CONTENT_SCROLL_CONFIG.nestedScrollEnabled, true)
})

test("wide-content scroll config has no unexpected keys", () => {
  assert.deepEqual(Object.keys(WIDE_CONTENT_SCROLL_CONFIG).sort(), [
    "horizontal",
    "nestedScrollEnabled",
    "showsHorizontalScrollIndicator",
  ])
})
