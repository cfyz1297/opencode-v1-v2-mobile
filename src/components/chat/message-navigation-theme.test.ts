// Theme guard for the #214 additions (navigation strip + error banners).
//
// Every new surface must exist in both themes: a light-only style renders as a
// bright slab in dark mode, which is what this file fails on. The screen cannot
// be rendered under node:test, so the stylesheet and the call sites are pinned
// at the source level.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const screen = readFileSync(path.join(root, "app/session/[id].tsx"), "utf8")

// Split the stylesheet so a style lookup cannot accidentally match the call site.
const stylesheet = screen.slice(screen.indexOf("const s = StyleSheet.create("))

function style(name: string): string {
  return stylesheet.match(new RegExp(`\\n  ${name}: \\{([^}]+)\\}`))?.[1] ?? ""
}

test("the navigation strip carries a dark variant and reaches the screen", () => {
  for (const name of ["navStrip", "navPill", "navPillText", "navCounter", "navLatest", "navLatestText"]) {
    assert.ok(style(name), `${name} must keep a light style`)
    assert.ok(style(`${name}Dark`), `${name} needs a dark counterpart`)
  }
  for (const name of ["navStrip", "navPill", "navPillText", "navCounter", "navLatest", "navLatestText"]) {
    assert.ok(
      screen.includes(`isDark && s.${name}Dark`),
      `${name}Dark must be applied with isDark at the call site`,
    )
  }
})

test("the navigation strip never paints light-on-light in dark mode", () => {
  assert.match(style("navStripDark"), /backgroundColor/, "dark strip needs its own surface colour")
  assert.match(style("navStripDark"), /borderTopColor/, "dark strip needs its own hairline colour")
  assert.match(style("navPillDark"), /borderColor/, "dark pill border must not stay light grey")
  assert.match(style("navPillTextDark"), /color/, "dark pill label must flip colour")
})

test("the Latest pill inverts its chevrons per theme", () => {
  // Filled pill: black on light theme, white on dark — the icon must follow the
  // fill, not the theme, or it disappears.
  const start = screen.indexOf('testID="nav-latest"')
  const latest = screen.slice(start, screen.indexOf("navLatestText", start))
  assert.match(latest, /color=\{isDark \? "#0a0a0a" : "#ffffff"\}/, "Latest chevrons must invert with the fill")
})

test("the error banners keep readable colours in both themes", () => {
  // Both banners paint their own saturated background, so the text stays light
  // in either theme; what must not happen is a theme-neutral rule slipping in.
  assert.match(style("bannerError"), /backgroundColor/, "error banner keeps its own background")
  assert.match(style("bannerErrorAction"), /color/, "error actions need an explicit colour")
  assert.match(style("bannerSubText"), /color/, "reconnect detail line needs an explicit colour")
  assert.match(style("bannerCopyPill"), /backgroundColor/, "Copy pill keeps a contrast background")
  assert.match(style("bannerCopyText"), /color/, "Copy pill text keeps a contrast colour")
})
