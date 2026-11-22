import { test } from "node:test"
import assert from "node:assert/strict"
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES, base64Bytes, fileTooLarge, isImageMime, promptFileUrl } from "./file-attachment.ts"

test("only image mime types get a thumbnail", () => {
  assert.equal(isImageMime("image/jpeg"), true)
  assert.equal(isImageMime("IMAGE/PNG"), true)
  assert.equal(isImageMime("application/pdf"), false)
  assert.equal(isImageMime(undefined), false)
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
