// "Notifications never arrive" on a phone that sits on the chat screen: send()
// suppressed every notification whenever AppState was "active", so a finished
// run, a permission request or a question produced nothing while the app was
// open — even on another screen or for another session.
//
// The rule now: suppress only what the user is already looking at. Everything
// else has to reach the shade, foreground or not.
import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldNotify } from "./notify-policy.ts"

test("viewing the session that produced the event: no banner over the chat", () => {
  assert.equal(shouldNotify(true, "ses_1", "ses_1"), false)
})

test("app in the foreground, but a different session is open: notify", () => {
  assert.equal(shouldNotify(true, "ses_2", "ses_1"), true)
})

test("app open on the session list (no session open): notify", () => {
  assert.equal(shouldNotify(true, "ses_1", null), true)
})

test("app in the background: always notify", () => {
  assert.equal(shouldNotify(false, "ses_1", "ses_1"), true)
  assert.equal(shouldNotify(false, undefined, null), true)
})

test("notifications without a session (connection) stay quiet while the app is open", () => {
  // The screen already shows the reconnecting banner in that case.
  assert.equal(shouldNotify(true, undefined, null), false)
  assert.equal(shouldNotify(true, "", "ses_1"), false)
  assert.equal(shouldNotify(false, undefined, null), true)
})
