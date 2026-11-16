// Theme guard for the session banners (store error + SSE reconnect).
//
// Both paint their own saturated background and keep light text in either
// theme; what must not happen is a theme-neutral rule slipping in, which is
// what this pins at the source level.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const screen = readFileSync(path.join(root, "app/session/[id].tsx"), "utf8")
const stylesheet = screen.slice(screen.indexOf("const s = StyleSheet.create("))

function style(name: string): string {
  return stylesheet.match(new RegExp(`\\n  ${name}: \\{([^}]+)\\}`))?.[1] ?? ""
}

test("the error banners keep readable colours in both themes", () => {
  assert.match(style("bannerError"), /backgroundColor/, "error banner keeps its own background")
  assert.match(style("bannerErrorAction"), /color/, "error actions need an explicit colour")
  assert.match(style("bannerSubText"), /color/, "reconnect detail line needs an explicit colour")
  assert.match(style("bannerCopyPill"), /backgroundColor/, "Copy pill keeps a contrast background")
  assert.match(style("bannerCopyText"), /color/, "Copy pill text keeps a contrast colour")
})
