import { test } from "node:test"
import assert from "node:assert/strict"
import { formatAnswer, recordAnswered, splitAnswered } from "./answered-questions.ts"

const request = { id: "form-1", questions: [{ header: "Stack", question: "Which stack?" }] }

test("an answered question is kept with its answers", () => {
  const list = recordAnswered([], request, [["Expo"]])
  assert.equal(list.length, 1)
  assert.equal(list[0].request.id, "form-1")
  assert.deepEqual(list[0].answers, [["Expo"]])
})

test("answering the same request again replaces the entry instead of duplicating it", () => {
  const first = recordAnswered([], request, [["Expo"]])
  const second = recordAnswered(first, request, [["Bare RN"]])
  assert.equal(second.length, 1)
  assert.deepEqual(second[0].answers, [["Bare RN"]])
})

test("answers are copied, so later edits to the caller's array cannot rewrite history", () => {
  const answers = [["Expo"]]
  const list = recordAnswered([], request, answers)
  answers[0].push("Bare RN")
  assert.deepEqual(list[0].answers, [["Expo"]])
})

test("multiple answered questions keep their order", () => {
  const list = recordAnswered(
    recordAnswered([], request, [["Expo"]]),
    { id: "form-2", questions: [{ header: "Lint", question: "Linter?" }] },
    [["ESLint"]],
  )
  assert.deepEqual(
    list.map((item) => item.request.id),
    ["form-1", "form-2"],
  )
})

test("formatAnswer joins multi-question answers into one readable line", () => {
  assert.equal(formatAnswer([["Expo"], ["ESLint", "Prettier"], ["  "]]), "Expo · ESLint · Prettier")
})

// The card used to be rendered above the composer, i.e. below the newest
// message: an answer picked in the middle of a run showed up under the final
// answer instead of under the question that asked it. V2 form metadata names
// the message and tool call that opened the form, so the card can stay exactly
// where the question was.

const withTool = (tool: { messageID: string; callID: string }) => ({ ...request, tool })

test("an answered question is attached to the message that asked it", () => {
  const list = recordAnswered([], withTool({ messageID: "msg_1", callID: "call_1" }), [["Expo"]])
  const { byMessage, unplaced } = splitAnswered(list)
  assert.deepEqual(byMessage.get("msg_1")?.map((item) => item.request.id), ["form-1"])
  assert.deepEqual(unplaced, [])
})

test("answers to the same message keep their order", () => {
  const first = recordAnswered([], withTool({ messageID: "msg_1", callID: "call_1" }), [["Expo"]])
  const list = recordAnswered(first, { ...withTool({ messageID: "msg_1", callID: "call_2" }), id: "form-2" }, [["Yes"]])
  const { byMessage } = splitAnswered(list)
  assert.deepEqual(byMessage.get("msg_1")?.map((item) => item.request.id), ["form-1", "form-2"])
})

test("a request without tool metadata stays unplaced instead of being dropped", () => {
  // V1's question events carry no tool reference — the card must still render.
  const { byMessage, unplaced } = splitAnswered(recordAnswered([], request, [["Expo"]]))
  assert.equal(byMessage.size, 0)
  assert.deepEqual(unplaced.map((item) => item.request.id), ["form-1"])
})
