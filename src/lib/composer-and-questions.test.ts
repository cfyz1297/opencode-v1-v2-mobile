// Composer behaviour that only exists in the screen.
//
// Runtime rendering for the session screen needs the whole RN/Expo graph, so —
// as in dialog-back-gesture.regression.test.ts — these pin the source and the
// pure helpers the screen uses.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const screen = readFileSync(path.join(root, "app/session/[id].tsx"), "utf8")

test("a follow-up can be sent while the agent is still working", () => {
  // `isSending` is the run flag: SSE clears it only when the session goes idle.
  // Blocking the send on it made every follow-up silently do nothing until the
  // run ended. The guard must be the request-in-flight ref instead.
  assert.doesNotMatch(screen, /if \(isSending\) return/)
  assert.match(screen, /const sendInFlight = useRef\(false\)/)
  assert.match(screen, /if \(sendInFlight\.current\) return/)
})

test("the send-in-flight guard is released even when the send throws", () => {
  assert.match(screen, /try \{\s*await sendNow\(\)\s*\} finally \{\s*sendInFlight\.current = false/)
})

test("answered questions are kept in the transcript instead of a 2.5s echo", () => {
  assert.match(screen, /splitAnswered\(answeredQuestions\)/)
  assert.match(screen, /answered\.byMessage\.get\(item\.message\.id\)/)
  assert.match(screen, /<AnsweredQuestionCard/)
  // Rendering them above the composer put the card below every later answer,
  // detached from the question it answered.
  assert.doesNotMatch(screen, /answeredQuestions\.map\(/)
  // V1 requests carry no message reference — they still have to render.
  assert.match(screen, /answered\.unplaced\.map\(/)
  // The old transient confirmation hid the answer after 2500ms.
  assert.doesNotMatch(screen, /setTimeout\(\(\) => setQuestionSentText\(null\), 2500\)/)
  assert.doesNotMatch(screen, /questionSentText/)
})

test("every question answer is recorded before the prompt is removed", () => {
  const reply = screen.slice(screen.indexOf("const handleQuestionReply"), screen.indexOf("const handleQuestionReject"))
  assert.match(reply, /recordQuestionAnswer\(sessionID, request, answers\)/)
  const reject = screen.slice(screen.indexOf("const handleQuestionReject"), screen.indexOf("const handleModelSelect"))
  assert.match(reject, /recordQuestionAnswer\(sessionID, request, \[\]\)/)
})
