// Layout guard for the transcript navigator (#214).
//
// The first attempt docked a 56pt strip under the list and the second used
// upstream's floating stack, which covered message text. This pins the contract
// the device run checks: a small translucent pill row floating over the
// transcript, hidden until the user scrolls, and ordered
// [counter] [up] [down] [latest] from left to right.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const source = readFileSync(new URL("../../../app/session/[id].tsx", import.meta.url), "utf8")
const stylesheet = source.slice(source.indexOf("const s = StyleSheet.create("))

function style(name: string): string {
  return stylesheet.match(new RegExp(`\\n  ${name}: \\{([^}]+)\\}`))?.[1] ?? ""
}

test("the navigator floats inside the list area, above the composer", () => {
  const panel = style("navPanel")
  assert.match(panel, /position:\s*"absolute"/, "the panel must float, not push the transcript")
  assert.match(panel, /right:\s*\d+/, "it sits on the right edge")
  assert.match(panel, /bottom:\s*\d+/, "and just above the composer")
  // Inside the list wrapper: before the empty state, after the FlatList.
  const listWrap = source.indexOf("<View style={s.listWrap}>")
  const panelAt = source.indexOf('testID="nav-panel"')
  const empty = source.indexOf("s.emptyOverlay")
  assert.ok(listWrap >= 0 && panelAt > listWrap && (empty < 0 || panelAt < empty), "panel must live in the list wrapper")
})

test("nothing is docked between the list and the status bar any more", () => {
  assert.doesNotMatch(source, /navStrip/, "the docked strip must be gone")
  assert.doesNotMatch(source, /scrollControls|scrollBtn/, "the floating stack must be gone")
  const status = source.indexOf("<StatusIndicator")
  const listEnd = source.indexOf("</View>", source.indexOf("<FlatList"))
  assert.ok(listEnd < status, "the list still closes before the status line")
})

test("the panel shows only while the user scrolls, then hides itself", () => {
  assert.match(source, /navPanelVisible = [^\n]*showNavStrip/, "visibility must be scroll-activity driven")
  assert.match(source, /onScrollBeginDrag=\{/, "a drag must wake the panel")
  assert.match(source, /onScrollEndDrag=\{wakeNavPanel\}/, "the fling must keep it up")
  assert.match(source, /onMomentumScrollEnd=\{wakeNavPanel\}/, "and so must the momentum end")
  assert.match(source, /setTimeout\(\(\) => setShowNavStrip\(false\)/, "it must hide on idle")
  assert.match(source, /clearTimeout\(navIdleTimer\.current\)/, "the idle timer must be cancelled and cleaned up")
})

test("a navigator tap owns the position until the user takes over", () => {
  // The reported bug: the counter moved to 3/5 while the transcript stayed at
  // the bottom, because content growth re-ran the auto-follow. A tap must stop
  // auto-follow, and only a manual drag or Latest may hand it back.
  const around = (marker: string, length = 600) => {
    const at = source.indexOf(marker)
    assert.ok(at >= 0, `${marker} must exist`)
    return source.slice(at, at + length)
  }
  const move = around("const moveMessage")
  assert.match(move, /followBottomRef\.current = false/, "a tap must stop auto-follow")
  assert.match(move, /navHoldRef\.current = true/, "and hold the position")
  assert.match(
    around("const handleScroll"),
    /!navHoldRef\.current && shouldFollowBottom/,
    "content growth must not snap back while held",
  )
  assert.match(around("onScrollBeginDrag={() =>"), /navHoldRef\.current = false/, "a finger on the list takes over")
  assert.match(around("const scrollToBottom"), /navHoldRef\.current = false/, "Latest hands the position back")
})

test("the list, not the frame math, says which message is current", () => {
  // A fling leaves rows outside the render window unmeasured, so the counter
  // read 12/12 on old messages and a tap seeked from that wrong base.
  assert.match(source, /onViewableItemsChanged=\{handleViewable\}/, "the list must report visible rows")
  const handler = source.slice(source.indexOf("const handleViewable"), source.indexOf("// Row frames for navigation."))
  assert.match(handler, /viewableItems[\s\S]{0,80}at\(-1\)/, "the row at the viewport's top edge is current")
  assert.match(handler, /nav\.setCurrent\(/, "and it is fed to the navigator")
})

test("a queued jump retry never outlives the next command", () => {
  // The retry timer was not cancelled: tapping Latest and then letting the
  // 120 ms retry fire scrolled the transcript back to the old message.
  const handler = source.slice(source.indexOf("onScrollToIndexFailed"), source.indexOf("keyExtractor"))
  assert.match(handler, /navJump\.current\?\.index !== index/, "a stale retry must be dropped")
  assert.match(handler, /navJump\.current\.timer = setTimeout/, "and its timer recorded")
  assert.match(source, /const cancelJump = useCallback/, "there must be a cancel")
  const bottom = source.slice(source.indexOf("const scrollToBottom"), source.indexOf("const handleScroll"))
  assert.match(bottom, /cancelJump\(\)/, "Latest cancels a pending jump")
  const jump = source.slice(source.indexOf("const jumpTo"), source.indexOf("const moveMessage"))
  assert.match(jump, /cancelJump\(\)/, "and so does a new jump")
})

test("one tap jumps by index, not by a frame-derived offset", () => {
  // Frames for rows outside the render window are stale or missing, so an
  // offset computed from them landed the jump on the wrong message.
  assert.match(source, /scrollToIndex\(\{\s*index, viewPosition: 0\.5/, "the list resolves the offset itself")
  assert.doesNotMatch(source, /nav\.seek\(/, "no offset math on the screen")
  assert.doesNotMatch(source, /measureRow/, "row frames are no longer needed")
  assert.doesNotMatch(source, /nav\.frames/, "and neither is a frame map")
})

test("order is counter, up, down, latest", () => {
  const order = ['testID="nav-counter"', 'testID="nav-up"', 'testID="nav-down"', 'testID="nav-latest"'].map((id) =>
    source.indexOf(id),
  )
  assert.ok(order.every((index) => index > 0), "all four controls must exist")
  assert.deepEqual([...order].sort((a, b) => a - b), order, "left to right: counter, up, down, latest")
})

test("Latest carries the double chevron", () => {
  const latest = source.slice(source.indexOf('testID="nav-latest"'), source.indexOf("navDoubleCaret:", source.indexOf('testID="nav-latest"')))
  assert.equal(
    latest.match(/name="chevron-down"/g)?.length,
    2,
    "two stacked chevrons mark the jump to the end",
  )
})

test("the panel stays small enough to sit over the text", () => {
  const button = style("navBtn")
  assert.match(button, /width:\s*32/, "buttons are 32pt, not 44")
  assert.match(button, /height:\s*32/)
  assert.match(style("navCounter"), /fontSize:\s*11/, "the counter is a caption, not a header")
  // Translucent surface: text underneath must stay readable.
  assert.match(style("navPanel"), /rgba\(255,255,255,0\.9/, "light panel is translucent")
  assert.match(style("navPanelDark"), /rgba\(18,18,18,0\.9/, "dark panel is translucent")
})

test("every navigator style has a dark counterpart where it paints", () => {
  for (const name of ["navPanel", "navCounter", "navLatest"]) {
    assert.ok(style(`${name}Dark`), `${name} needs a dark variant`)
    assert.ok(source.includes(`isDark && s.${name}Dark`), `${name}Dark must reach the render`)
  }
})
