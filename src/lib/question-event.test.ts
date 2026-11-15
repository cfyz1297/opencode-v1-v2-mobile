// A question asked by the model must reach the chat UI.
//
// V2 surfaces the `question` tool as a session form tagged
// metadata.kind === "question" and pushes `form.created`; the adapter turns it
// into V1 `question.asked`, and the store keys it by the form's sessionID. The
// envelope below is copied verbatim from a live 2.3.0 server, because the
// mapping is sensitive to where the payload nests (data.form).
import { test } from "node:test"
import assert from "node:assert/strict"
import { V2EventAdapter } from "./v2-compat.ts"

const envelope = {
  id: "evt_1dc3a2738001hITbJ6teCHzCfJ",
  created: 1794696161080,
  type: "form.created",
  location: { directory: "/data/data/com.termux/files/home/daily-usage" },
  data: {
    form: {
      id: "frm_1dc3a2737001NYHTO0o6vDF2Uq",
      sessionID: "ses_e23cdf8a0ffeyo5GmH2R9Dybty",
      title: "Questions",
      metadata: { kind: "question", tool: { messageID: "msg_probe2", id: "call_probe" } },
      fields: [
        {
          key: "q0",
          title: "Размер шрифта",
          description: "Увеличен ли шрифт?",
          type: "string",
          options: [
            { value: "yes", label: "Да, увеличен" },
            { value: "no", label: "Нет, обычный" },
          ],
          custom: true,
        },
      ],
    },
  },
}

test("form.created becomes a question.asked the store can key by session", () => {
  const events = new V2EventAdapter().adapt(envelope as never)
  assert.equal(events.length, 1)
  const event = events[0] as { type: string; properties: Record<string, unknown> }
  assert.equal(event.type, "question.asked")
  assert.equal(event.properties.sessionID, envelope.data.form.sessionID)
  assert.equal(event.properties.id, envelope.data.form.id)
  // The card is drawn under the message that asked, which needs the ref.
  assert.deepEqual(event.properties.tool, { messageID: "msg_probe2", callID: "call_probe" })
  const questions = event.properties.questions as Array<{ header: string; question: string; options: unknown[] }>
  assert.equal(questions.length, 1)
  assert.equal(questions[0].question, "Увеличен ли шрифт?")
  assert.equal(questions[0].options.length, 2)
})

test("a form that is not a question is not turned into a prompt", () => {
  const other = structuredClone(envelope)
  other.data.form.metadata = { kind: "other" } as never
  assert.deepEqual(new V2EventAdapter().adapt(other as never), [])
})
