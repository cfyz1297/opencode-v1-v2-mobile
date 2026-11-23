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
test("the attach button opens a sheet with camera, photo and files", () => {
  const menu = block("const openAttachMenu = useCallback(", "}, [])")
  assert.match(menu, /attachSheetRef\.current\?\.snapToIndex\(0\)/, "the menu is our own sheet, opened at its compact detent")
  assert.match(src, /onPress=\{openAttachMenu\}/)
  // The sheet itself, and every source wired to a real picker.
  const sheet = readFileSync(path.join(root, "src/components/chat/AttachMenuSheet.tsx"), "utf8")
  assert.match(sheet, /t\("session\.attach\.camera"\)/)
  assert.match(sheet, /t\("session\.attach\.photo"\)/)
  assert.match(sheet, /t\("session\.attach\.file"\)/)
  assert.match(sheet, /bottom-sheet/, "it reuses the app's sheet component, not a new one")
  // An Alert cannot carry icons and renders in the system style; the reported
  // problem was that the menu looked foreign next to the rest of the app.
  assert.doesNotMatch(menu, /Alert\.alert/)
  // The sheet closes before a picker opens, or the picker lands behind it.
  assert.match(sheet, /sheetRef\.current\?\.close\(\)\s*\n\s*openPicker\(\)/)
  // The camera shares the guard: its row stays pressable while the sheet
  // slides away for the ~250 ms before onChange reports the close.
  // The guard is only a guard if the flag is set before the work and cleared
  // afterwards: without the set it is dead, without the clear the flag sticks
  // on and every picker stops working after the first camera use. Each line
  // must be a real statement (a commented-out copy is the likeliest debugging
  // step) and the set must precede the awaited work.
  const camera = block("const pickFromCamera = useCallback(", "}, [openCamera])")
  assert.match(camera, /^[ \t]*if \(pickingRef\.current\) return[ \t]*$/m, "camera checks the flag first")
  assert.match(
    camera,
    /^[ \t]*pickingRef\.current = true[ \t]*$[\s\S]*await openCamera\(\)/m,
    "camera sets the flag before the work",
  )
  assert.match(
    camera,
    /^[ \t]*\} finally \{[ \t]*$[\s\S]*^[ \t]*pickingRef\.current = false[ \t]*$/m,
    "camera clears the flag in finally",
  )
  // Wired, not merely defined: the screen must render the sheet and point each
  // row at its own picker. Swapping two of them kept every test green before.
  assert.match(src, /<AttachMenuSheet/)
  assert.match(src, /onCamera=\{\(\) => void pickFromCamera\(\)\}/)
  assert.match(src, /onPhoto=\{\(\) => void pickFromLibrary\(\)\}/)
  assert.match(src, /onFile=\{\(\) => void pickFile\(\)\}/)
  // Same trap as the model and effort pickers: the IME is up in the composer,
  // and a sheet opened behind it looks like a dead button. Order matters, and
  // it has to be a real call statement: a bare `Keyboard.dismiss()` mentioned
  // in a comment, or a helper defined above and called after the open, left
  // the sheet behind the keyboard with the loose check green.
  assert.match(menu, /^[ \t]*Keyboard\.dismiss\(\)[ \t]*$[\s\S]*snapToIndex\(0\)/m, "the keyboard goes first")
  // Each row must keep its label and its handler together. A chained regex
  // proved order and formatting instead of wiring: reordering the rows failed
  // while swapping two labels stayed green. The `key` is deliberately not
  // matched — it only feeds React's key and a testID nobody reads, so renaming
  // it changes no behavior. `[^}]*` stays inside one row.
  const rows: Array<[string, RegExp]> = [
    ["camera", /label: t\("session\.attach\.camera"\)[^}]*onPress: pick\(onCamera\)/],
    ["photo", /label: t\("session\.attach\.photo"\)[^}]*onPress: pick\(onPhoto\)/],
    ["file", /label: t\("session\.attach\.file"\)[^}]*onPress: pick\(onFile\)/],
  ]
  for (const [source, pattern] of rows) {
    assert.match(sheet, pattern, `the ${source} row keeps its label and its own picker`)
  }
  assert.equal((sheet.match(/label: t\("session\.attach\./g) ?? []).length, 3, "exactly three rows")
  // The Alert it replaced was cancelable, so Back dismissed it. A sheet is a
  // plain view: without this, Back leaves the session with the menu still up.
  assert.match(sheet, /hardwareBackPress/)
  assert.match(sheet, /sheetRef\.current\?\.close\(\)\s*\n\s*return true/)
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
