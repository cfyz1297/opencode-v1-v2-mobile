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
  assert.match(source, /onScrollEndDrag=\{[\s\S]{0,700}wakeNavPanel\(\)/, "the fling must keep it up")
  assert.match(source, /onMomentumScrollEnd=\{[\s\S]{0,200}wakeNavPanel\(\)/, "and so must the momentum end")
  assert.match(source, /setTimeout\(\(\) => setShowNavStrip\(false\)/, "it must hide on idle")
  assert.match(source, /clearTimeout\(navIdleTimer\.current\)/, "the idle timer must be cancelled and cleaned up")
})

test("a navigator tap owns the position until the user takes over", () => {
  // Streaming content re-ran the auto-follow and scrolled back to the bottom,
  // so the counter said 3/5 over the newest message.
  const around = (marker: string, length = 700) => {
    const at = source.indexOf(marker)
    assert.ok(at >= 0, `${marker} must exist`)
    return source.slice(at, at + length)
  }
  const jump = around("const jumpTo")
  assert.match(jump, /nav\.jumpTo\(id\)/, "the jump sets and holds the position in one step")
  assert.match(around("const moveMessage"), /followBottomRef\.current = false/, "a tap must stop auto-follow")
  const scroll = around("const handleScroll", 1200)
  // Following is decided by the gesture (the tap above clears it, and only the
  // end of a drag or a fling can restore it): a scroll sample must never turn it
  // back on, which is what dragged the reader to the bottom mid-jump.
  assert.doesNotMatch(scroll, /followBottomRef\.current =/, "no scroll sample may change auto-follow")
  assert.match(scroll, /if \(atBottom && !nav\.held\) nav\.setCurrent\(nav\.ids\[nav\.ids\.length - 1\]\)/, "at the bottom the newest message is current")
  assert.match(around("onScrollBeginDrag={() =>"), /nav\.manual\(\)/, "a finger on the list takes over")
  assert.match(around("const scrollToBottom"), /nav\.release\(\)/, "Latest hands the position back")
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
})

test("the navigator walks the user's own messages", () => {
  // Assistant rows stream, grow and re-merge, so navigating them was
  // unreliable; a question is a fixed anchor.
  assert.match(source, /userRowIds\(listRows\)/, "targets come from the user rows, in list order")
  const jump = source.slice(source.indexOf("const jumpTo"), source.indexOf("const moveMessage"))
  assert.match(jump, /rowIndexById\.get\(id\)/, "the jump maps the question to a list index")
  assert.match(jump, /animated: false/, "an animated jump over a long transcript reads as a freeze")
})

test("the position comes from measured user rows, not from viewability", () => {
  // Viewability does not fire until something scrolls, so a freshly opened
  // session had no position: the counter read "5 / 5" at the top and the buttons
  // did nothing until a manual swipe.
  assert.doesNotMatch(source, /onViewableItemsChanged/, "no dependency on the viewability callback")
  assert.doesNotMatch(source, /viewabilityConfig/, "and no viewability config")
  // The cell wrapper is the only view positioned inside the content container;
  // an onLayout on the rendered row reports y = 0 relative to its cell, which
  // made every frame sit at the top and the counter read "N / N" there.
  assert.match(source, /CellRendererComponent=\{measureCell\}/, "the cell is the measuring boundary")
  const cell = source.slice(source.indexOf("const measureCell"), source.indexOf("const jumpTo"))
  assert.match(cell, /nav\.frames\.set\(row\.id,/, "the cell's layout feeds the navigator")
  assert.match(cell, /props\.onLayout\?\.\(event\)/, "the list's own layout handler still runs")
  assert.match(cell, /kind === "single" && row\.item\.message\.role === "user"/, "only user messages are kept")
})

test("a tap works before anything has been measured", () => {
  // Opening a session starts at the newest message. The list runs oldest →
  // newest, so that is the LAST index — not 0, and not -1, which made every
  // button a no-op.
  const at = source.indexOf("const moveMessage")
  assert.ok(at >= 0, "moveMessage must exist")
  const move = source.slice(at, at + 900)
  assert.match(move, /const current = known >= 0 \? known : nav\.ids\.length - 1/, "an unknown position starts from the newest question")
})

test("an unknown position does not claim to be the oldest", () => {
  // The list runs oldest → newest, so an unknown position resolves to the last
  // row: a session opens at the newest message.
  assert.match(source, /const resolvedNavIndex = navIndex >= 0 \? navIndex : navTotal - 1/)
  assert.match(source, /const navCurrent = resolvedNavIndex \+ 1/)
  assert.match(source, /const nextDisabled = resolvedNavIndex >= navTotal - 1/, "only the newest message disables Next")
})

test("the buttons are wide enough to hit", () => {
  const button = style("navBtn")
  assert.match(button, /width:\s*40/, "buttons are 40pt, not 32")
  assert.match(button, /height:\s*40/)
  assert.equal(source.match(/hitSlop=\{6\}/g)?.length, 3, "every navigator button extends its hit area")
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
  assert.match(button, /width:\s*40/, "buttons are 40pt, not 44")
  assert.match(style("navCounter"), /fontSize:\s*12/, "the counter is a caption, not a header")
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
