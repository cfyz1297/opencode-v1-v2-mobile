// Three reported "nothing happens" taps. The screen can't be rendered under
// node:test (same constraint as dialog-back-gesture.regression.test.ts), so the
// invariants are pinned in the source.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const src = readFileSync(path.join(root, "app/session/[id].tsx"), "utf8")

function block(start: string, end: string): string {
  const from = src.indexOf(start)
  assert.notEqual(from, -1, `missing ${start}`)
  const to = src.indexOf(end, from)
  assert.notEqual(to, -1, `missing ${end}`)
  return src.slice(from, to)
}

test("the stop button follows the server's busy status, not only the optimistic send flag", () => {
  // A run started elsewhere (opened mid-run, app restarted, SSE reconnected)
  // has isSending=false while the server is still executing a tool, and used
  // to have no stop button at all.
  assert.match(src, /const canStop = isSending \|\| sessionBusy/)
  assert.match(src, /\{canStop && !speech\.listening && \(/)
  assert.doesNotMatch(src, /\{isSending && !speech\.listening && \(\s*<TouchableOpacity style=\{s\.stopBtn\}/)
})

test("a failed abort tells the user instead of only writing a store error", () => {
  const abort = block("const handleAbort = useCallback(", "}, [abortSession, t])")
  assert.match(abort, /Alert\.alert\(t\("session\.alerts\.abortFailedTitle"\)/)
  assert.match(src, /onPress=\{handleAbort\}/)
})

test("opening the image picker cannot fail silently", () => {
  const picker = block("const pickFromLibrary = useCallback(", "}, [t])")
  // Unhandled rejection from launchImageLibraryAsync was the silent path.
  assert.match(picker, /catch \(err\)/)
  assert.match(picker, /Alert\.alert\(t\("session\.alerts\.imageFailedTitle"\)/)
  // Double tap / IME animation makes Android return a canceled result.
  assert.match(picker, /if \(pickingRef\.current\) return/)
  assert.match(picker, /Keyboard\.dismiss\(\)/)
})

test("the gallery picker survives a system picker that refuses to launch", () => {
  // Reported: tapping + showed "Изображение не прикреплено" immediately, with
  // no picker UI at all — launchImageLibraryAsync rejected before any choice.
  // The system photo picker intent is the fragile part; `legacy: true` uses
  // ACTION_GET_CONTENT, which any device with a file manager can answer.
  const picker = block("const pickFromLibrary = useCallback(", "}, [t])")
  assert.match(picker, /legacy: true/)
  // Retry must happen *inside* the failure path, not instead of the first try.
  assert.match(picker, /catch \(err\)[\s\S]*launchLibrary\(true\)/)
  // The reason is invisible otherwise: logcat only, and release builds drop it.
  // Diagnostics reports carry the log ring buffer, so record the real error.
  assert.match(picker, /log\.error\(/)
  // A failed convert (toJpeg) shows the same generic alert; it must name the
  // reason too, otherwise "try another photo" is all the next report says.
  assert.match(picker, /log\.error\("ImagePicker", "processing failed:"/)
})

test("reading the clipboard cannot fail silently", () => {
  const paste = block("const pasteFromClipboard = useCallback(", "}, [t])")
  assert.match(paste, /catch \(err\)/)
  assert.match(paste, /Alert\.alert\(t\("session\.alerts\.imageFailedTitle"\)/)
})
