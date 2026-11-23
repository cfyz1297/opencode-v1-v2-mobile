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

// The attach button opened the photo picker directly, so a .txt/.json/.pdf/.zip
// could not be sent at all — the native opencode client accepts any file.
test("the attach button offers photos and any file", () => {
  const menu = block("const openAttachMenu = useCallback(", "}, [t, pickFromLibrary, pickFile])")
  assert.match(menu, /t\("session\.attach\.photo"\)/)
  assert.match(menu, /t\("session\.attach\.file"\)/)
  assert.match(menu, /Alert\.alert/)
  // The photo path must stay exactly what it was.
  assert.match(menu, /pickFromLibrary/)
  assert.match(src, /onPress=\{openAttachMenu\}/)
})

test("a picked file reaches the prompt as bytes, never as a cache path", () => {
  const pick = block("const pickFile = useCallback(", "}, [attachments, t])")
  assert.match(pick, /DocumentPicker\.getDocumentAsync/)
  // The server cannot read the phone's filesystem: the bytes travel as base64
  // in the prompt, so an unread file is an attachment that would never arrive.
  assert.match(pick, /\.base64\(\)/)
  assert.match(pick, /base64,/)
  assert.match(pick, /catch \(err\)/)
  assert.match(pick, /Alert\.alert\(t\("session\.alerts\.fileFailedTitle"\)/)
  // Same reasoning as the photo picker: release builds drop console output.
  assert.match(pick, /log\.error\("FilePicker"/)
  // ...but the log carries reasons, not the picked names: this buffer is
  // embedded in the diagnostic report the user pastes into an issue. Forbid
  // the argument, not one wording — the names must never reach it in any form.
  assert.doesNotMatch(pick, /log\.error\("FilePicker",[^\n]*problems\b/, "file names must not enter the shared log")
  assert.match(pick, /log\.error\("FilePicker", `\$\{reasons\.length\}[^`]*\$\{reasons\.join/, "the reason stays diagnosable")
  // A mistaken huge pick would freeze the app while base64-encoding it, and a
  // second pick must not reset the batch budget.
  assert.match(pick, /fileTooLarge\(file\.size, attachedBytes\)/)
  assert.match(pick, /attachments\.reduce/)

  // The one line the whole feature rests on: send uses base64 when present.
  const sessions = readFileSync(path.join(root, "src/stores/sessions.ts"), "utf8")
  assert.match(sessions, /promptFileUrl\(f\)/, "the prompt must build the data URL from the bytes")
})
