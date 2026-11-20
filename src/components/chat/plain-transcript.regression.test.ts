// The transcript is a plain list: oldest at the top, newest at the bottom. That
// is the whole fix for "the text I am reading crawls away while an answer
// streams" — growth at the bottom cannot move text above it.
//
// The inverted version needed a correction for the same symptom, and four
// attempts failed in the field (per-cell deltas were summed, a baseline was read
// after being overwritten, and the native maintainer did nothing on an inverted
// list). These checks keep the list uninverted and keep the pieces that depend
// on the direction in the right place.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const sessionSource = readFileSync(new URL("../../../app/session/[id].tsx", import.meta.url), "utf8")

function listBlock(): string {
  const start = sessionSource.lastIndexOf("<FlatList")
  assert.ok(start >= 0, "the session screen must render a FlatList")
  return sessionSource.slice(start, sessionSource.indexOf("ListHeaderComponent", start))
}

test("the transcript is not inverted", () => {
  const block = listBlock()
  assert.doesNotMatch(block, /\binverted\b/, "an inverted list moves every row when the newest one grows")
  assert.match(block, /data=\{listRows\}/, "rows must be rendered oldest first")
  assert.match(sessionSource, /const listRows = useMemo\(\(\) => \[\.\.\.rows\]\.reverse\(\)/, "and the order flipped only once")
})

test("growing content is followed only from the bottom", () => {
  const block = listBlock()
  // scrollToEnd stops at the last row's measured frame, which lags the chunk
  // that just arrived; the measured content height is the real end.
  assert.match(
    block,
    /if \(!followBottomRef\.current\) return[\s\S]{0,400}scrollToContentEnd\(false\)/,
    "the newest text is kept in view",
  )
  assert.doesNotMatch(block, /\.scrollToEnd\(/, "a row frame must not decide where the end is")
  assert.doesNotMatch(block, /scrollToOffset\(\{ offset: [^)]*\+/, "no measured correction arithmetic is left")
})

test("older pages load from the start of the list", () => {
  const block = listBlock()
  assert.match(block, /onStartReached=\{handleLoadMore\}/, "history lives at the top of a plain list")
  assert.doesNotMatch(block, /onEndReached=/, "onEndReached would fire at the newest end instead")
})

// Prepend is the one case a plain list still needs the native helper for: rows
// inserted above the reader would push their text down.
test("rows inserted above the reader are kept still", () => {
  assert.match(listBlock(), /maintainVisibleContentPosition=\{MAINTAIN_VISIBLE_CONTENT_POSITION\}/, "prepends must not move the reader")
})

test("the list stays hidden until it has settled at the newest message", () => {
  // It mounts at offset 0, which is now the oldest row: showing that frame
  // flashes the beginning of a long conversation.
  assert.match(listBlock(), /style=\{settled \? undefined : s\.hidden\}/, "the first frames must not be shown")
  assert.match(listBlock(), /requestAnimationFrame\(revealList\)/, "revealed after the jump lands, not on a second equal height")
  assert.match(sessionSource, /settleTimerRef\.current = setTimeout\(revealList, 400\)/, "and by a timer if no layout event ever comes")
  const drag = listBlock().slice(listBlock().indexOf("onScrollBeginDrag"))
  assert.match(drag, /revealList\(\)/, "touching the list reveals it too")
})

// Coming back from a subagent session shows the spinner and unmounts the list;
// it then mounts again at the oldest row. The "already settled" state from
// before made that first frame visible, dropping the reader at the top of a
// long history — caught by the emulator smoke run on the first attempt.
test("a cold reload opens at the newest message again", () => {
  assert.match(sessionSource, /if \(!isLoading\) return[\s\S]{0,200}settledRef\.current = false/, "a reload must hide the list again")
  assert.match(sessionSource, /if \(!isLoading\) return[\s\S]{0,240}followBottomRef\.current = true/, "a reload follows the stream again")
})

// The reported bug: at the bottom the list stopped following the answer. Follow
// was derived from every scroll sample, and a streaming delta grows the content
// between two samples (100 ms throttle), so the sample looked like "scrolled
// away" and following switched off for good.
test("following is decided by the gesture, never by a scroll sample", () => {
  const scroll = sessionSource.slice(
    sessionSource.indexOf("const handleScroll"),
    sessionSource.indexOf("const settleFollow"),
  )
  assert.doesNotMatch(scroll, /followBottomRef\.current =/, "a stale sample must not switch following off")
  const block = listBlock()
  assert.match(block, /onScrollBeginDrag=\{[\s\S]{0,600}followBottomRef\.current = false/, "a drag takes the position")
  assert.match(block, /onScrollEndDrag=\{[\s\S]{0,300}velocity[\s\S]{0,300}settleFollow\(event\)/, "a lift only settles when no fling follows")
  assert.match(block, /onMomentumScrollEnd=\{[\s\S]{0,200}settleFollow\(event\)/, "the fling that ends there gives it back")
  const settle = sessionSource.slice(sessionSource.indexOf("const settleFollow"), sessionSource.indexOf("const measureCell"))
  assert.match(settle, /followBottomRef\.current = isNearBottom\(/, "one decision point for both gestures")
})

// The same stale-frame trap sits behind "Latest" and the pending-question jump:
// both used scrollToEnd, so both could stop a line short of the newest text.
test("jumps to the newest end aim past it and let the native list clip", () => {
  const helper = sessionSource.slice(
    sessionSource.indexOf("const scrollToContentEnd"),
    sessionSource.indexOf("const nav ="),
  )
  assert.match(helper, /followScrollOffset\(contentHeightRef\.current, viewportHeightRef\.current, Platform\.OS\)/, "the platform decides how to aim")
  assert.match(sessionSource, /contentHeightRef\.current = height/, "the height comes from the content-size event")
  const jump = sessionSource.slice(sessionSource.indexOf("const scrollToBottom"), sessionSource.indexOf("// Re-select on every focus"))
  assert.match(jump, /scrollToContentEnd\(animated\)/, "Latest goes through it")
  assert.match(sessionSource, /followBottomRef\.current = true\n\s*\/\/ The card sits[^\n]*\n\s*scrollToContentEnd\(true\)/, "so does the pending-question jump")
})

// The composer, the status row, banners and the keyboard resize the list while
// an answer streams; a fixed offset then leaves the newest line out of view, or
// the content above the bottom.
test("a resized list is landed on the end again while following", () => {
  const layout = sessionSource.slice(
    sessionSource.indexOf("onLayout={(event) => {"),
    sessionSource.indexOf("onScrollBeginDrag="),
  )
  assert.match(layout, /const resized = height !== viewportHeightRef\.current/, "only a real size change")
  assert.match(
    layout,
    /if \(resized && settledRef\.current && followBottomRef\.current\) scrollToContentEnd\(false\)/,
    "re-anchored while following, and only then",
  )
})

// A short transcript never re-fires onStartReached, so it needs one automatic
// fetch — but exactly one: without the ref, every streaming delta would fetch
// the whole transcript again.
test("a short transcript loads history once, not on every growth", () => {
  const block = listBlock()
  assert.match(block, /if \(!autoLoadedOlderRef\.current && height <= viewportHeightRef\.current && hasMore && !loadingMore\)/, "the one-shot guard must cover the whole condition")
  assert.match(block, /autoLoadedOlderRef\.current = true\n\s*loadOlderMessages\(\)/, "the ref is set before the fetch")
  assert.match(sessionSource, /autoLoadedOlderRef\.current = false/, "and reset for the next session")
})

// Without this guard the initial onStartReached at offset 0 pulls a page of
// history on every session open.
test("history is not pulled while the reader follows the stream", () => {
  const at = sessionSource.indexOf("const handleLoadMore")
  const fn = sessionSource.slice(at, at + 420)
  assert.match(fn, /if \(followBottomRef\.current\) return/, "loading older requires the reader to be away from the bottom")
})

// Android scrolls a focused child into view; a selectable <Text> takes focus on
// long-press and used to yank the transcript (facebook/react-native#33440).
test("long-press selection still cannot scroll the list", () => {
  assert.match(listBlock(), /scrollsChildToFocus=\{false\}/, "a focused selectable text must not be scrolled to")
})
