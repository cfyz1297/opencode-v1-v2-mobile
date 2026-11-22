// Chat text carries URLs in shapes GFM autolink does not cover: inside
// backticks (agents write `https://…`), without a scheme (www.), with trailing
// punctuation, or wrapped in prose parentheses (upstream #284). These pure
// helpers decide what is a link; the renderer and the user-message component
// both consume them.
import { test } from "node:test"
import assert from "node:assert/strict"
import { extractSingleUrl, splitTextWithUrls } from "./linkify.ts"

test("plain text stays one unlinked segment", () => {
  assert.deepEqual(splitTextWithUrls("npm run build"), [{ text: "npm run build" }])
})

test("a bare URL in prose becomes a link, trailing period excluded", () => {
  assert.deepEqual(splitTextWithUrls("See https://example.com/a."), [
    { text: "See " },
    { text: "https://example.com/a", url: "https://example.com/a" },
    { text: "." },
  ])
})

test("www. without a scheme is linkified with https", () => {
  const [, link] = splitTextWithUrls("go to www.example.com now")
  assert.equal(link.url, "https://www.example.com")
  assert.equal(link.text, "www.example.com")
})

test("an unmatched closing paren is punctuation, a balanced one is part of the URL", () => {
  const [link, rest] = splitTextWithUrls("(see https://example.com/docs)")
  assert.equal(link.text, "(see ")
  assert.equal(rest.url, "https://example.com/docs")

  const [article] = splitTextWithUrls("https://en.wikipedia.org/wiki/Link_(film) is the page")
  assert.equal(article.url, "https://en.wikipedia.org/wiki/Link_(film)")
})

test("several URLs in one line all become links, in order", () => {
  const segments = splitTextWithUrls("a https://one.test b https://two.test?q=1! b")
  assert.deepEqual(
    segments.filter((s) => s.url).map((s) => s.url),
    ["https://one.test", "https://two.test?q=1"],
  )
})

test("an inline-code span that is exactly one URL is a link", () => {
  assert.equal(extractSingleUrl("https://example.com/x"), "https://example.com/x")
  assert.equal(extractSingleUrl("www.example.com"), "https://www.example.com")
  assert.equal(extractSingleUrl(" https://example.com/x "), "https://example.com/x")
})

test("anything else in backticks stays inert code", () => {
  // Code must not become a link: `npm run build`, a path, a shell command.
  assert.equal(extractSingleUrl("npm run build"), null)
  assert.equal(extractSingleUrl("https://example.com/x --flag"), null)
  assert.equal(extractSingleUrl("src/lib/linkify.ts"), null)
})

test("a URL glued to a sentence is still the link, not the sentence", () => {
  const [link, after] = splitTextWithUrls("https://example.com:8080/path) then done")
  assert.equal(link.url, "https://example.com:8080/path")
  assert.equal(after.text, ") then done")
})
