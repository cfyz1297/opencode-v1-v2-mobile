// Short display form of an SSE disconnect reason for the reconnect banner
// (#214 AF-4). Errors stringify as "Error: <message>" — drop the redundant
// prefix so the banner reads like a transport message, and cap the length so
// a verbose error can't blow out the banner.
export function disconnectReasonText(reason: unknown): string {
  return String(reason).replace(/^Error:\s*/, "").slice(0, 200)
}
