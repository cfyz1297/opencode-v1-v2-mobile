import { test } from "node:test"
import assert from "node:assert/strict"

// React keys for a parsed markdown tree.
//
// The library's Renderer derives every key from github-slugger (`slugger.slug`
// with one constant prefix). Each call adds a property to the slugger's
// `occurrences` object, and the renderer instance survives re-renders, so the
// count only grows: at 196,607 properties Hermes throws
// "Property storage exceeds 196607 properties" and the app dies mid-session.
// Keys only need to be unique within one parse, so a counter is enough — it
// stores nothing and has no ceiling.
export function createMarkdownKeys(prefix = "markdown-key"): () => string {
  let next = 0
  return () => `${prefix}-${next++}`
}
