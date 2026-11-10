// Unit tests for the V2 → V1 compatibility layer (src/lib/v2-compat.ts).
// Shapes come from live V2 payloads captured during the port (see
// `opencode api get /openapi.json` + real SSE captures) so the mappings keep
// matching what the server actually sends.
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildFormAnswer,
  clampMessageLimit,
  joinPath,
  mapAgents,
  mapForms,
  mapCommands,
  mapFileEntries,
  mapMessages,
  mapPermissions,
  mapProviders,
  mapProjects,
  mapSession,
  mapProjectFromLocation,
  unwrapData,
  V2EventAdapter,
} from "./v2-compat.ts"

// Test conveniences: the adapter's public `properties` is a generic record,
// while these tests assert concrete V1 fields. One loose view keeps the
// assertions readable without changing the production type.
const adapter = () => {
  const events = new V2EventAdapter()
  return {
    adapt: (event: Parameters<V2EventAdapter["adapt"]>[0]) =>
      events.adapt(event) as Array<{ type: string; properties: any }>,
  }
}

describe("unwrapData", () => {
  it("unwraps v2 {data} envelopes", () => {
    assert.deepEqual(unwrapData({ data: [1, 2] }), [1, 2])
  })
  it("unwraps {data: null} payloads to []", () => {
    assert.deepEqual(unwrapData<{ x: number }>({ data: null }), [])
  })
  it("passes unwrapped bodies through", () => {
    assert.deepEqual(unwrapData(42), 42)
  })
})

describe("clampMessageLimit", () => {
  it("clamps to the v2 server limit of 200", () => {
    assert.equal(clampMessageLimit(300), 200)
    assert.equal(clampMessageLimit(200), 200)
    assert.equal(clampMessageLimit(25), 25)
    assert.equal(clampMessageLimit(undefined), undefined)
  })
})

describe("mapSession", () => {
  it("maps a v2 Session.Info into the v1 shape", () => {
    const session = mapSession(
      {
        id: "ses_1",
        projectID: "proj_1",
        time: { created: 100, updated: 200 },
        location: { directory: "/home/user/proj" },
        revert: { messageID: "msg_9" },
      },
      "/fallback",
    )
    assert.equal(session.id, "ses_1")
    assert.equal(session.directory, "/home/user/proj")
    assert.equal(session.time.created, 100)
    assert.equal(session.time.updated, 200)
    assert.equal(session.revert?.messageID, "msg_9")
  })
  it("falls back to the fallback directory when v2 has no location", () => {
    assert.equal(mapSession({ id: "ses_2", projectID: "p" }, "/fallback").directory, "/fallback")
  })
})

describe("mapMessages", () => {
  // Realistic v2 payload order: newest first (server returns newest-first).
  const v2 = [
    {
      id: "msg_a",
      type: "assistant",
      time: { created: 200, completed: 500 },
      agent: "build",
      model: { id: "gpt-x", providerID: "openai" },
      content: [
        { type: "reasoning", text: "thinking" },
        { type: "tool", id: "t-1", name: "shell", state: { status: "completed", input: { command: "ls" }, content: [{ type: "text", text: "file.txt" }] } },
        { type: "text", text: "done" },
      ],
      finish: "tool-calls",
      cost: 0.01,
      tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 1, write: 2 } },
    },
    {
      id: "msg_b",
      type: "synthetic", // non-conversation types must be filtered
      time: { created: 150 },
      text: "hi",
    },
    {
      id: "msg_c",
      type: "user",
      time: { created: 100 },
      text: "please list files",
    },
  ]

  const mapped = mapMessages(v2, "ses_1")

  it("reverses to ascending order and filters non user/assistant types", () => {
    assert.deepEqual(
      mapped.map((m) => m.info.id),
      ["msg_c", "msg_a"],
    )
  })

  it("maps the assistant info", () => {
    const info = mapped[1].info
    assert.equal(info.role, "assistant")
    assert.equal(info.modelID, "gpt-x")
    assert.equal(info.providerID, "openai")
    assert.equal(info.finish, "tool-calls")
    assert.equal(info.cost, 0.01)
    assert.deepEqual(info.tokens, { input: 10, output: 5, reasoning: 2, cache: { read: 1, write: 2 } })
    assert.equal(info.time.completed, 500)
  })

  it("maps content into v1 part types with synthesized ids", () => {
    const parts = mapped[1].parts
    assert.deepEqual(
      parts.map((p) => p.type),
      ["reasoning", "tool", "text"],
    )
    assert.deepEqual(
      parts.map((p) => p.id),
      ["msg_a_0", "msg_a_1", "msg_a_2"],
    )
    const tool = parts[1]
    assert.equal(tool.tool, "shell")
    assert.equal(tool.callID, "t-1")
    assert.equal(tool.state?.status, "completed")
    assert.deepEqual(tool.state?.input, { command: "ls" })
    assert.equal(tool.state?.output, "file.txt")
  })

  it("maps streaming tool state to v1 pending", () => {
    const one = mapMessages(
      [{ id: "msg_d", type: "assistant", time: { created: 1 }, content: [{ type: "tool", id: "t2", name: "read", state: { status: "streaming", input: "" } }] }],
      "ses",
    )[0]
    assert.equal(one.parts[0].state?.status, "pending")
  })

  it("keeps a completed compaction and exposes its summary", () => {
    const [one] = mapMessages(
      [
        {
          type: "compaction",
          id: "msg_k",
          time: { created: 10 },
          status: "completed",
          reason: "manual",
          summary: "## Objective\n- ship it",
        },
      ],
      "ses",
    )
    assert.equal(one.info.role, "system")
    assert.equal(one.parts.length, 1)
    assert.equal(one.parts[0].type, "compaction")
    assert.equal(one.parts[0].text, "## Objective\n- ship it")
    assert.equal(one.parts[0].status, "completed")
  })

  it("keeps a failed compaction with the server error text", () => {
    const [one] = mapMessages(
      [
        {
          type: "compaction",
          id: "msg_k2",
          time: { created: 11 },
          status: "failed",
          reason: "manual",
          error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
        },
      ],
      "ses",
    )
    assert.equal(one.info.role, "system")
    assert.equal(one.parts[0].type, "compaction")
    assert.equal(one.parts[0].text, "Nothing to compact yet")
    assert.equal(one.parts[0].status, "failed")
  })

  it("renders a v2 inline attachment from its base64 data string", () => {
    const [one] = mapMessages(
      [
        {
          id: "msg_img",
          type: "user",
          time: { created: 12 },
          text: "what is this?",
          files: [
            {
              data: "/9j/AA==",
              mime: "image/jpeg",
              source: { type: "inline" },
              name: "image.jpg",
            },
          ],
        },
      ],
      "ses",
    )
    const file = one.parts.find((p) => p.type === "file")
    assert.equal(file?.url, "data:image/jpeg;base64,/9j/AA==")
    assert.equal(file?.mime, "image/jpeg")
    assert.equal(file?.filename, "image.jpg")
  })

  it("prefers inline data over the provenance uri", () => {
    const [one] = mapMessages(
      [
        {
          id: "msg_img2",
          type: "user",
          time: { created: 13 },
          files: [
            {
              data: "aGVsbG8=",
              mime: "image/png",
              source: { type: "uri", uri: "file:///home/user/photo.png" },
            },
          ],
        },
      ],
      "ses",
    )
    assert.equal(one.parts.find((p) => p.type === "file")?.url, "data:image/png;base64,aGVsbG8=")
  })

  it("does not emit an empty image uri that renders as a white box", () => {
    const [one] = mapMessages(
      [
        {
          id: "msg_img3",
          type: "user",
          time: { created: 14 },
          files: [
            {
              mime: "image/jpeg",
              source: { type: "uri", uri: "file:///home/user/photo.jpg" },
              name: "photo.jpg",
            },
          ],
        },
      ],
      "ses",
    )
    assert.equal(one.parts.filter((p) => p.type === "file").length, 0)
  })
})

describe("catalog mappings", () => {
  it("maps agents", () => {
    const agents = mapAgents([
      { id: "build", name: "Build", mode: "primary", hidden: false, model: { id: "m1", providerID: "p1" } },
    ])
    assert.deepEqual(agents, [
      { id: "build", name: "Build", mode: "primary", hidden: false, native: true, options: {}, model: { modelID: "m1", providerID: "p1" }, description: undefined, color: undefined },
    ])
  })

  it("maps commands with an empty template", () => {
    assert.deepEqual(mapCommands([{ name: "init", description: "setup" }]), [
      { name: "init", description: "setup", template: "", hints: [] },
    ])
  })

  it("groups models per provider and maps the default", () => {
    const catalog = mapProviders(
      [
        {
          id: "x", modelID: "m1", providerID: "p1", name: "Model One",
          capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
          variants: [{ id: "low", settings: { reasoningEffort: "low" } }],
          cost: [{ input: 2, output: 4 }],
          limit: { context: 128000, output: 4096 },
          status: "active",
        },
      ],
      { providerID: "p1", id: "x", modelID: "m1" },
    )
    assert.equal(catalog.all[0].id, "p1")
    // The catalog id (`id`), not the upstream `modelID`, is what Model.Ref
    // carries in sessions and what the switch endpoint accepts.
    const model = catalog.all[0].models.x
    assert.equal(model.id, "x")
    assert.equal(model.attachment, true)
    assert.equal(model.reasoning, true)
    assert.equal(model.tool_call, true)
    assert.deepEqual(model.limit, { context: 128000, output: 4096 })
    assert.deepEqual(model.variants, { low: { reasoningEffort: "low" } })
    assert.deepEqual(catalog.default, { p1: "x" })
    assert.deepEqual(catalog.connected, ["p1"])
  })

  it("skips models the location cannot use", () => {
    const catalog = mapProviders(
      [
        { id: "on", providerID: "p1", name: "On", enabled: true },
        { id: "off", providerID: "p1", name: "Off", enabled: false },
      ],
      null,
    )
    assert.deepEqual(Object.keys(catalog.all[0].models), ["on"])
  })
})

describe("location mappings", () => {
  it("maps /api/location to the current project", () => {
    const project = mapProjectFromLocation({
      directory: "/home/u/proj/src",
      project: { id: "proj1", directory: "/home/u/proj", canonical: "/home/u/proj" },
    })
    assert.equal(project?.id, "proj1")
    assert.deepEqual(project?.path, { cwd: "/home/u/proj", root: "/home/u/proj", absolute: "/home/u/proj" })
  })

  it("maps the project list", () => {
    const projects = mapProjects([{ id: "p1", canonical: "/home/u/proj", time: {}, sandboxes: [] }])
    assert.equal(projects[0].path.cwd, "/home/u/proj")
  })

  it("maps fs entries to absolute paths the browser can navigate", () => {
    const entries = mapFileEntries(
      [
        { path: ".cache/", type: "directory" },
        { path: ".gitconfig", type: "file" },
      ],
      "/home/u",
    )
    assert.deepEqual(entries[0], { name: ".cache", path: ".cache", absolute: "/home/u/.cache", type: "directory", ignored: false })
    assert.deepEqual(entries[1], { name: ".gitconfig", path: ".gitconfig", absolute: "/home/u/.gitconfig", type: "file", ignored: false })
    assert.equal(joinPath("/base", "child"), "/base/child")
    assert.equal(joinPath("/base", "."), "/base")
  })
})

describe("mapPermissions", () => {
  it("maps action/resources/source to permission/patterns/tool", () => {
    const mapped = mapPermissions([
      {
        id: "per_1",
        sessionID: "ses_1",
        action: "external_directory",
        resources: ["/etc/*"],
        source: { type: "tool", messageID: "msg_1", id: "call_1" },
      },
    ])
    assert.deepEqual(mapped, [
      {
        id: "per_1",
        sessionID: "ses_1",
        permission: "external_directory",
        patterns: ["/etc/*"],
        metadata: {},
        tool: { messageID: "msg_1", callID: "call_1" },
      },
    ])
  })
})

describe("V2EventAdapter", () => {
  it("maps execution started/ended to v1 session.status busy/idle", () => {
    const a = adapter()
    const busy = a.adapt({ type: "session.execution.started", data: { sessionID: "ses_1" } })
    assert.equal(busy.length, 1)
    assert.deepEqual(busy[0].properties.status, { type: "busy" })
    const idle = a.adapt({ type: "session.execution.succeeded", created: 5, data: { sessionID: "ses_1" } })
    assert.deepEqual(idle[0].properties.status, { type: "idle" })
  })

  // session.execution.failed used to map to the exact same output as succeeded — a bare "session.status: idle" with no error signal.
  // Fixed: failed now emits a v1 session.error with the server's message, so
  // the store marks erroredSessions, shows an error banner, and does not count
  // the failure toward the store-review prompt.
  it("BUG-003: execution.failed emits session.error, not a plain idle status", () => {
    const a = adapter()
    const events = a.adapt({ type: "session.execution.failed", created: 5, data: { sessionID: "ses_1", error: { message: "boom" } } })
    assert.equal(events.length, 1)
    assert.equal(events[0].type, "session.error")
    assert.deepEqual(events[0].properties, {
      sessionID: "ses_1",
      error: { message: "boom" },
    })
    // succeeded still maps to plain idle (no regression)
    const ok = a.adapt({ type: "session.execution.succeeded", created: 6, data: { sessionID: "ses_1" } })
    assert.deepEqual(ok[0].properties.status, { type: "idle" })
  })


  it("streams text deltas into one message.updated + accumulating part.updated events", () => {
    const a = adapter()
    const first = a.adapt({
      type: "session.text.started", created: 10,
      data: { sessionID: "ses_1", assistantMessageID: "msg_a", ordinal: 0 },
    })
    // message.updated (register) + empty part placeholder
    assert.equal(first[0].type, "message.updated")
    assert.equal(first[0].properties.info.role, "assistant")
    assert.equal(first[0].properties.info.id, "msg_a")
    assert.equal(first[1].type, "message.part.updated")
    assert.equal(first[1].properties.part.text, "")

    const delta1 = a.adapt({
      type: "session.text.delta", created: 11,
      data: { sessionID: "ses_1", assistantMessageID: "msg_a", ordinal: 0, delta: "Hello" },
    })
    assert.equal(delta1[0].properties.part.text, "Hello")
    assert.equal(delta1[0].properties.part.sessionID, "ses_1")

    const delta2 = a.adapt({
      type: "session.text.delta", created: 12,
      data: { sessionID: "ses_1", assistantMessageID: "msg_a", ordinal: 0, delta: " world" },
    })
    assert.equal(delta2[0].properties.part.text, "Hello world")

    // text.started of a SECOND message never re-emits message.updated for the first
    const second = a.adapt({
      type: "session.text.started", created: 13,
      data: { sessionID: "ses_1", assistantMessageID: "msg_a", ordinal: 1 },
    })
    assert.deepEqual(
      second.map((e) => e.type),
      ["message.part.updated"],
    )
  })

  it("emits a single message.updated exactly once per assistant message", () => {
    const a = adapter()
    a.adapt({ type: "session.step.started", created: 1, data: { sessionID: "s", assistantMessageID: "m1", agent: "build", model: { id: "m", providerID: "p" } } })
    const second = a.adapt({ type: "session.text.started", created: 2, data: { sessionID: "s", assistantMessageID: "m1", ordinal: 0 } })
    assert.ok(!second.some((e) => e.type === "message.updated"))
  })

  it("uses step.ended to finalize message tokens/cost/finish", () => {
    const a = adapter()
    a.adapt({ type: "session.step.started", created: 1, data: { sessionID: "s", assistantMessageID: "m1", agent: "build", model: { id: "m", providerID: "p" } } })
    const ended = a.adapt({
      type: "session.step.ended", created: 9,
      data: { sessionID: "s", assistantMessageID: "m1", finish: "stop", cost: 0.02, tokens: { input: 4, output: 6 } },
    })
    const update = ended.find((e) => e.type === "message.updated")
    assert.equal(update?.properties.info.tokens?.input, 4)
    assert.equal(update?.properties.info.finish, "stop")
    assert.equal(update?.properties.info.time.completed, 9)
  })

  it("tracks tool lifecycle into v1 tool parts", () => {
    const a = adapter()
    a.adapt({ type: "session.step.started", created: 1, data: { sessionID: "s", assistantMessageID: "m1", agent: "build", model: { id: "m", providerID: "p" } } })
    const started = a.adapt({
      type: "session.tool.input.started", created: 2,
      data: { sessionID: "s", assistantMessageID: "m1", id: "t1", name: "shell" },
    })
    const part = started.find((e) => e.type === "message.part.updated")?.properties.part
    assert.equal(part.tool, "shell")
    assert.equal(part.state.status, "pending")

    const inputEnded = a.adapt({
      type: "session.tool.input.ended", created: 3,
      data: { sessionID: "s", assistantMessageID: "m1", id: "t1", text: '{"command":"ls"}' },
    })
    const inputPart = inputEnded.find((e) => e.type === "message.part.updated")?.properties.part
    assert.equal(inputPart.state.input.command, "ls")
    assert.equal(inputPart.callID, "t1")

    a.adapt({ type: "session.tool.called", created: 4, data: { sessionID: "s", assistantMessageID: "m1", id: "t1" } })
    const success = a.adapt({
      type: "session.tool.success", created: 5,
      data: { sessionID: "s", assistantMessageID: "m1", id: "t1", content: [{ type: "text", text: "out\n" }] },
    })
    const donePart = success.find((e) => e.type === "message.part.updated")?.properties.part
    assert.equal(donePart.state.status, "completed")
    assert.equal(donePart.state.output, "out\n")
  })

  it("gives a tool part a time window, which V2 never sends", () => {
    // Live V2 tool parts carry no state.time at all, so the card had nothing
    // to measure and never showed a duration - a long run looked frozen.
    const a = adapter()
    a.adapt({ type: "session.step.started", created: 1, data: { sessionID: "s", assistantMessageID: "m1", agent: "build", model: { id: "m", providerID: "p" } } })
    const started = a.adapt({
      type: "session.tool.input.started", created: 2_000,
      data: { sessionID: "s", assistantMessageID: "m1", id: "t1", name: "shell" },
    })
    const pending = started.find((e) => e.type === "message.part.updated")?.properties.part
    assert.deepEqual(pending.state.time, { start: 2_000 })

    const success = a.adapt({
      type: "session.tool.success", created: 9_000,
      data: { sessionID: "s", assistantMessageID: "m1", id: "t1", content: [] },
    })
    const done = success.find((e) => e.type === "message.part.updated")?.properties.part
    assert.deepEqual(done.state.time, { start: 2_000, end: 9_000 }, "the window opens once and closes at the end")
  })

  it("keeps the progress title so a running tool says what it is doing", () => {
    // session.tool.progress carries only metadata.title; it was accepted by
    // toolPartUpdated and then dropped, leaving a blank row for long runs.
    const a = adapter()
    a.adapt({ type: "session.step.started", created: 1, data: { sessionID: "s", assistantMessageID: "m1", agent: "build", model: { id: "m", providerID: "p" } } })
    a.adapt({
      type: "session.tool.input.started", created: 2,
      data: { sessionID: "s", assistantMessageID: "m1", id: "t1", name: "shell" },
    })
    const progress = a.adapt({
      type: "session.tool.progress", created: 3,
      data: { sessionID: "s", assistantMessageID: "m1", id: "t1", metadata: { title: "npm test" } },
    })
    const part = progress.find((e) => e.type === "message.part.updated")?.properties.part
    assert.equal(part.state.title, "npm test")
    assert.equal(part.state.status, "running")
    // The earlier empty input must survive as a started marker, not overwrite it.
    assert.deepEqual(part.state.input, {})
  })

  it("maps permission.asked to the app's permission shape", () => {
    const a = adapter()
    const out = a.adapt({
      type: "permission.asked", created: 1,
      data: {
        id: "per_1", sessionID: "ses_1", action: "bash",
        resources: ["/etc/*"],
        source: { type: "tool", messageID: "msg_1", id: "call_1" },
      },
    })
    assert.equal(out.length, 1)
    assert.deepEqual(out[0].properties, {
      id: "per_1",
      sessionID: "ses_1",
      permission: "bash",
      patterns: ["/etc/*"],
      metadata: {},
      tool: { messageID: "msg_1", callID: "call_1" },
    })
  })

  it("passes permission.replied through unchanged", () => {
    const a = adapter()
    const out = a.adapt({
      type: "permission.replied",
      data: { sessionID: "ses_1", requestID: "per_1", reply: "once" },
    })
    assert.equal(out[0].type, "permission.replied")
    assert.equal(out[0].properties.requestID, "per_1")
  })

  it("ignores unknown event types", () => {
    const a = adapter()
    assert.deepEqual(a.adapt({ type: "server.connected", data: {} }), [])
    assert.deepEqual(a.adapt({ type: "session.inbox.enqueued", data: {} }), [])
  })
})

// --- BUG-004: model questions are V2 forms with metadata.kind "question" ----

const questionForm = {
  id: "frm_1",
  sessionID: "ses_1",
  title: "Questions",
  metadata: { kind: "question", tool: { messageID: "msg_1", id: "call_1" } },
  fields: [
    {
      key: "q0",
      type: "string",
      title: "Framework",
      description: "Which framework?",
      options: [
        { value: "react", label: "React", description: "UI library" },
        { value: "vue", label: "Vue" },
      ],
      custom: true,
    },
    {
      key: "q1",
      type: "multiselect",
      title: "Extras",
      description: "Pick extras",
      options: [{ value: "ts", label: "TypeScript" }],
      custom: true,
    },
  ],
}

describe("mapForms", () => {
  it("maps a question form to the V1 question shape", () => {
    const out = mapForms([questionForm])
    assert.equal(out.length, 1)
    assert.equal(out[0].id, "frm_1")
    assert.equal(out[0].sessionID, "ses_1")
    assert.deepEqual(out[0].questions, [
      {
        header: "Framework",
        question: "Which framework?",
        options: [
          { label: "React", description: "UI library" },
          { label: "Vue", description: "" },
        ],
        multiple: false,
        custom: true,
      },
      {
        header: "Extras",
        question: "Pick extras",
        options: [{ label: "TypeScript", description: "" }],
        multiple: true,
        custom: true,
      },
    ])
    assert.deepEqual(out[0].tool, { messageID: "msg_1", callID: "call_1" })
  })

  it("ignores forms that are not question prompts", () => {
    const other = { ...questionForm, id: "frm_2", metadata: { kind: "websearch.provider" } }
    assert.deepEqual(mapForms([questionForm, other]).map((q) => q.id), ["frm_1"])
  })

  it("skips fields the question UI cannot render", () => {
    const form = {
      ...questionForm,
      fields: [...questionForm.fields, { key: "ack", type: "external", title: "Ack" }],
    }
    assert.equal(mapForms([form])[0].questions.length, 2)
  })

  it("drops question forms with no renderable fields", () => {
    const form = { ...questionForm, fields: [{ key: "ack", type: "external" }] }
    assert.deepEqual(mapForms([form]), [])
  })

  it("tolerates malformed payloads", () => {
    assert.deepEqual(mapForms(undefined), [])
    assert.deepEqual(mapForms({ data: [questionForm] }), [])
  })
})

describe("buildFormAnswer", () => {
  const fields = [
    {
      key: "q0",
      type: "string",
      options: [
        { value: "react", label: "React" },
        { value: "vue", label: "Vue" },
      ],
      custom: true,
    },
    {
      key: "q1",
      type: "multiselect",
      options: [
        { value: "ts", label: "TypeScript" },
        { value: "css", label: "CSS" },
      ],
      custom: true,
    },
    { key: "ack", type: "external", title: "Ack" },
  ]

  it("sends a scalar for single choice and an array for multiselect", () => {
    assert.deepEqual(buildFormAnswer(fields, [["React"], ["TypeScript", "CSS"]]), {
      q0: "react",
      q1: ["ts", "css"],
    })
  })

  it("passes custom answers through as raw text", () => {
    assert.deepEqual(buildFormAnswer(fields, [["Svelte"], ["WASM"]]), {
      q0: "Svelte",
      q1: ["WASM"],
    })
  })

  it("accepts option values as well as labels", () => {
    assert.deepEqual(buildFormAnswer(fields, [["vue"], []]), { q0: "vue" })
  })

  it("omits unanswered questions", () => {
    assert.deepEqual(buildFormAnswer(fields, [[], []]), {})
    assert.deepEqual(buildFormAnswer(fields, [["React"], []]), { q0: "react" })
  })

  it("tolerates missing fields or answers", () => {
    assert.deepEqual(buildFormAnswer(undefined, [["React"]]), { q0: "React" })
    assert.deepEqual(buildFormAnswer(fields, []), {})
  })
})

describe("V2EventAdapter forms", () => {
  it("maps a question form.created to question.asked", () => {
    const out = adapter().adapt({ type: "form.created", data: { form: questionForm } })
    assert.equal(out.length, 1)
    assert.equal(out[0].type, "question.asked")
    assert.equal(out[0].properties.id, "frm_1")
    assert.equal(out[0].properties.sessionID, "ses_1")
    assert.equal((out[0].properties.questions as unknown[]).length, 2)
  })

  it("drops non-question forms", () => {
    const out = adapter().adapt({
      type: "form.created",
      data: { form: { ...questionForm, metadata: { kind: "websearch.provider" } } },
    })
    assert.deepEqual(out, [])
  })

  it("maps form.replied to question.replied", () => {
    const out = adapter().adapt({
      type: "form.replied",
      data: { id: "frm_1", sessionID: "ses_1", answer: { q0: "react" } },
    })
    assert.equal(out.length, 1)
    assert.equal(out[0].type, "question.replied")
    assert.equal(out[0].properties.requestID, "frm_1")
    assert.equal(out[0].properties.sessionID, "ses_1")
  })

  it("maps form.cancelled to question.rejected", () => {
    const out = adapter().adapt({
      type: "form.cancelled",
      data: { id: "frm_1", sessionID: "ses_1" },
    })
    assert.equal(out.length, 1)
    assert.equal(out[0].type, "question.rejected")
    assert.equal(out[0].properties.requestID, "frm_1")
    assert.equal(out[0].properties.sessionID, "ses_1")
  })
})
