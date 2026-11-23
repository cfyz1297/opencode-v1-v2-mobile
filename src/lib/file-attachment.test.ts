import { test } from "node:test"
import assert from "node:assert/strict"
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES, attachmentBytes, base64Bytes, fileTooLarge, isImageMime, promptFileUrl } from "./file-attachment.ts"

test("only raster image types get a thumbnail", () => {
  for (const mime of ["image/jpeg", "image/jpg", "image/png", "IMAGE/PNG", "image/gif", "image/webp", "image/bmp"]) {
    assert.equal(isImageMime(mime), true, `${mime} renders in RN Image`)
  }
  // An SVG is an image mime but RN Image draws it as an empty box; it must fall
  // through to the document tile instead of pretending to be a preview.
  for (const mime of ["image/svg+xml", "application/pdf", "text/plain", undefined]) {
    assert.equal(isImageMime(mime), false, `${mime} has no RN preview`)
  }
})

test("the size cap rejects a file one byte over and keeps the limit itself", () => {
  assert.equal(fileTooLarge(MAX_ATTACHMENT_BYTES), false)
  assert.equal(fileTooLarge(MAX_ATTACHMENT_BYTES + 1), true)
  // An unknown size is not rejected here: the picker reads the real one from
  // the file itself before deciding.
  assert.equal(fileTooLarge(undefined), false)
})

test("several files share one budget", () => {
  // Two files under the per-file cap still cannot blow the batch budget.
  assert.equal(fileTooLarge(MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_BYTES), false)
  assert.equal(fileTooLarge(MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES - 1), true)
})

test("a provider reporting 0 or -1 for size falls back to the real file size", () => {
  // The picker uses File.size, which is 0 when the file cannot be read; the
  // read itself then throws and the catch reports it. Only a real size counts.
  assert.equal(fileTooLarge(0), false)
})

test("the prompt carries bytes, not the phone's cache path", () => {
  const picked = { mime: "text/plain", uri: "file:///cache/note.txt", base64: "aGV5" }
  assert.equal(promptFileUrl(picked), "data:text/plain;base64,aGV5")

  // A 0-byte file reads as "" — still content, still must not fall back to the
  // uri, which the server cannot open.
  assert.equal(promptFileUrl({ ...picked, base64: "" }), "data:text/plain;base64,")

  // Attachments restored after a revert have no separate base64: their uri is
  // already the data: URL the server sent back.
  const restored = { mime: "image/jpeg", uri: "data:image/jpeg;base64,AAAA" }
  assert.equal(promptFileUrl(restored), "data:image/jpeg;base64,AAAA")
})

test("base64 length converts back to bytes for the batch budget", () => {
  assert.equal(base64Bytes(Buffer.from("012345678").toString("base64")), 9)
  assert.equal(base64Bytes(""), 0)
  // Padding makes the estimate overshoot by a byte or two, which is the safe
  // direction for a budget.
  assert.ok(base64Bytes(Buffer.from("0123456789").toString("base64")) >= 10)
})

test("a restored attachment is priced by its data: URL, not at zero", () => {
  const payload = Buffer.alloc(1024, 7).toString("base64")
  // The Edit path restores {uri: "data:...;base64,..."} with no base64 field;
  // counting only the field let a 15 MB restored file and a 10 MB pick through
  // a 20 MB budget.
  // base64Bytes deliberately overshoots by the padding bytes, which is the safe
  // direction for a budget.
  const estimate = base64Bytes(payload)
  assert.ok(estimate >= 1024 && estimate < 1040, `got ${estimate}`)
  assert.equal(attachmentBytes({ uri: `data:application/pdf;base64,${payload}` }), estimate)
  assert.equal(attachmentBytes({ uri: "file:///cache/x", base64: payload }), estimate)
  // A path with no bytes behind it contributes nothing.
  assert.equal(attachmentBytes({ uri: "file:///cache/x" }), 0)
})
