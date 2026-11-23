// Chat text carries URLs in shapes GFM autolink does not cover: inside
// backticks (agents write `https://…`), without a scheme (www.), with trailing
// punctuation, or wrapped in prose parentheses (upstream #284). These pure
// helpers decide what is a link; the renderer and the user-message component
// both consume them.
import { test } from "node:test"
import assert from "node:assert/strict"
import { extractSingleUrl, isAllowedLinkScheme, splitTextWithUrls } from "./linkify.ts"

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

test("only web and contact schemes are dispatched to the OS", () => {
  // A model-written markdown href can be any scheme; react-native-marked
  // passes all of them through. These must fall back to Copy instead of
  // launching an installed app's intent with attacker-chosen data.
  for (const blocked of ["javascript:alert(1)", "data:text/html,<h1>x", "file:///etc/passwd", "content://x/y", "intent://evil#Intent;end", "opencode://session/1"]) {
    assert.equal(isAllowedLinkScheme(blocked), false, `${blocked} must not be dispatched`)
  }
  for (const allowed of ["https://example.com", "http://127.0.0.1:4096", "mailto:a@b.c", "tel:+123", "HTTPS://Example.com"]) {
    assert.equal(isAllowedLinkScheme(allowed), true, `${allowed} must open`)
  }
  // A scheme-less string is not a link and has nothing to dispatch.
  assert.equal(isAllowedLinkScheme("example.com/x"), false)
})

test("a bare URL with an @ in the authority is not linkified", () => {
  // www.evil.com@good.com shows one host and opens another, and the user never
  // wrote it as a link — so it stays plain text.
  assert.equal(splitTextWithUrls("look www.evil.com@good.com now").some((s) => s.url), false)
  assert.equal(splitTextWithUrls("see https://evil.example@good.example").some((s) => s.url), false)
  // An '@' in the path is ordinary and keeps working.
  assert.equal(splitTextWithUrls("https://a.example/@octocat")[0].url, "https://a.example/@octocat")
})
