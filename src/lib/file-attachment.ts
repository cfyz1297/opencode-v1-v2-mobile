// Rules for files the composer attaches besides photos. Kept pure so they run
// under node:test without the picker or React Native.
//
// The server never sees the phone's filesystem: an attachment travels as a
// data: URL in the prompt, so its whole content is base64-encoded into the
// request body (and kept in app state until the send). The caps keep a
// mistaken pick from freezing or killing the app before the server sees it.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
// Several files share this budget: four 9 MB picks would otherwise build ~48 MB
// of base64 in state and again in the request body.
export const MAX_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024

export function isImageMime(mime: string | undefined): boolean {
  return !!mime && mime.toLowerCase().startsWith("image/")
}

// Some SAF providers report 0 or -1 for "unknown size" instead of null, and
// File.size is 0 for a file it cannot read — base64() throws for that case.
export function fileTooLarge(size: number | undefined, alreadyAttached = 0): boolean {
  if (size == null) return false
  return size > MAX_ATTACHMENT_BYTES || alreadyAttached + size > MAX_ATTACHMENT_TOTAL_BYTES
}

export function base64Bytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4)
}

// What the prompt carries for one attachment. The server never sees the
// phone's filesystem, so a picked file must travel as a data: URL — the uri of
// a document-picker copy is a cache path and would reach the server as a path
// it cannot open. An empty string is still real content (a 0-byte file), hence
// the !== undefined check rather than a truthiness one.
export function promptFileUrl(file: { mime: string; uri: string; base64?: string }): string {
  return file.base64 !== undefined ? `data:${file.mime};base64,${file.base64}` : file.uri
}
