// Pure URL detection for chat text. The renderer (Markdown.tsx) and the plain
// user-message surface (LinkifiedText.tsx) both need it, and the screen code
// cannot be imported under node:test — this module is the seam.
//
// Agents format URLs in ways GFM autolink misses: inside backticks, without a
// scheme, followed by punctuation, wrapped in prose parentheses (upstream #284).

export interface TextSegment {
  text: string
  url?: string
}

// A URL-looking run: http(s)://… or www.…, up to whitespace or a delimiter
// that cannot be part of a URL. Parens stay in the run because a real URL can
// contain them (…/wiki/Link_(film)); trailing closers are trimmed below only
// when unbalanced.
const URL_RUN = /(https?:\/\/[^\s<>"'\[\]{}]+|www\.[^\s<>"'\[\]{}]+)/g

const CLOSERS = [")", "]", "}"]
const OPENERS = ["(", "[", "{"]

function stripTrailingPunctuation(candidate: string): string {
  let end = candidate.length
  while (end > 0 && ".,;:!?".includes(candidate[end - 1])) end--
  // Drop a trailing closer with no matching opener, e.g. the ")" in
  // "(see https://example.com/docs)", but keep balanced ones.
  for (let i = 0; i < CLOSERS.length; i++) {
    const closer = CLOSERS[i]
    const opener = OPENERS[i]
    let depth = 0
    for (let j = 0; j < end; j++) {
      if (candidate[j] === opener) depth++
      if (candidate[j] === closer) depth--
    }
    while (end > 0 && candidate[end - 1] === closer && depth < 0) {
      end--
      depth++
    }
  }
  return candidate.slice(0, end)
}

function normalizeUrl(raw: string): string {
  return raw.startsWith("www.") ? `https://${raw}` : raw
}

// Split plain text into plain and URL segments. A URL segment's text is the
// URL as written (trailing punctuation stripped); its url is what opens.
export function splitTextWithUrls(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let last = 0
  for (const match of text.matchAll(URL_RUN)) {
    const trimmed = stripTrailingPunctuation(match[0])
    if (!trimmed) continue
    const start = match.index ?? 0
    if (start > last) segments.push({ text: text.slice(last, start) })
    segments.push({ text: trimmed, url: normalizeUrl(trimmed) })
    last = start + trimmed.length
  }
  if (last < text.length) segments.push({ text: text.slice(last) })
  return segments.length > 0 ? segments : [{ text }]
}

// The whole string is one URL (an inline-code span's content) — return the URL
// to open, or null for anything else, so ordinary code stays inert.
export function extractSingleUrl(text: string): string | null {
  const cleaned = stripTrailingPunctuation(text.trim())
  if (!/^(https?:\/\/|www\.)\S+$/.test(cleaned)) return null
  return normalizeUrl(cleaned)
}
