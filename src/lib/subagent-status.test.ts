// The row that shows a delegated subagent must tell "still working" from
// "finished" without the parent tool part, which completes at dispatch time.
import { test } from "node:test"
import assert from "node:assert/strict"
import { collectSubagents, deriveSubagentStatus, orderSubagents, summarizeSubagents, visibleSubagents } from "./subagent-status.ts"

const child = (idle?: number) => ({ time: { created: 1, updated: 2, ...(idle ? { idle } : {}) } })
const stamped = (busy: number, idle?: number) => ({ time: { created: 1, updated: 2, busy, ...(idle ? { idle } : {}) } })

test("a child with a live busy status is running even though it has no idle stamp", () => {
  assert.equal(deriveSubagentStatus(child(), { type: "busy" }, undefined), "running")
  assert.equal(deriveSubagentStatus(child(), { type: "retry" }, undefined), "running")
})

test("a child that finished before the app connected still reads as done", () => {
  // No live status after a reconnect: the idle stamp is the only evidence.
  assert.equal(deriveSubagentStatus(child(99), undefined, undefined), "done")
})

test("an error wins over a stale busy status", () => {
  assert.equal(deriveSubagentStatus(child(), { type: "busy" }, "boom"), "failed")
})

test("a child that was created but never started is idle", () => {
  // Nothing observed for it: no live event, no stamp.
  assert.equal(deriveSubagentStatus(child(), undefined, undefined), "idle")
  assert.equal(deriveSubagentStatus(undefined, undefined, undefined), "idle")
})

test("a child that just went idle flips to done without re-entering the screen", () => {
  // The child row is fetched when the screen opens, so its cached copy has no
  // idle stamp, and V2 never sends session.updated to refresh it. The live
  // idle event is then the only evidence the run finished — without it the pill
  // read "Ожидает" for a subagent that had already completed.
  assert.equal(deriveSubagentStatus(child(), { type: "idle" }, undefined), "done")
  assert.equal(deriveSubagentStatus(undefined, { type: "idle" }, undefined), "done")
})

test("the summary counts each child exactly once", () => {
  // a: busy → running; b: idle stamp → done; c: errored → failed; d: neither → idle
  const children = [child(), child(99), child(99), child()]
  const live = { a: { type: "busy" } }
  const errors = { c: "boom" }
  const ids = ["a", "b", "c", "d"]
  const withIds = children.map((c, i) => ({ ...c, id: ids[i] }))
  assert.deepEqual(summarizeSubagents(withIds, live, errors), { running: 1, done: 1, failed: 1, idle: 1 })
})

const part = (child: string, index = 1) => ({
  type: "tool",
  tool: "subagent",
  sessionID: "parent-1",
  state: { input: { agent: "general", description: `task ${index}` }, metadata: { sessionID: child } },
})

test("the bar lists every delegated subagent in call order", () => {
  const refs = collectSubagents([
    { parts: [part("c1", 1), { type: "text" }] },
    { parts: [part("c2", 2)] },
    // A retried part must not add a duplicate row.
    { parts: [part("c1", 1)] },
  ])
  assert.deepEqual(refs.map((r) => r.sessionID), ["c1", "c2"])
  assert.equal(refs[0].parentID, "parent-1")
  assert.equal(refs[1].title, "task 2")
})

test("a resumed child session is a new row, not a duplicate of the old call", () => {
  // The screenshot bug: this turn resumed a session an earlier turn had spawned
  // (D). Deduplicating on the child id alone dropped D's call and left the
  // hour-old row in its place, so "Сейчас" showed only C.
  const refs = collectSubagents([
    turn("user", []),
    turn("assistant", [part("ses-shared", 1)]),
    turn("user", []),
    turn("assistant", [part("ses-c", 2), part("ses-shared", 3)]),
  ])
  assert.deepEqual(
    refs.map((r) => [r.sessionID, r.wave, r.title]),
    [
      ["ses-shared", 1, "task 1"],
      ["ses-c", 2, "task 2"],
      ["ses-shared", 2, "task 3"],
    ],
  )
  // Both calls of the current turn are in the "current" list.
  assert.deepEqual(visibleSubagents(refs, done).map((r) => r.sessionID), ["ses-c", "ses-shared"])
})

test("a running subagent is never buried under finished ones", () => {
  const refs = collectSubagents([
    { parts: [part("c1", 1), part("c2", 2), part("c3", 3)] },
  ])
  const ordered = orderSubagents(refs, (ref) => (ref.sessionID === "c3" ? "running" : "done"))
  assert.deepEqual(ordered.map((r) => r.sessionID), ["c3", "c1", "c2"])
})

test("finished subagents are ordered newest first, not in call order", () => {
  // The screenshot bug: run-4 (3 h ago) sat above run-5 (2 h ago) because the
  // list kept call order. The row's own "N ago" stamp is the order key.
  const refs = collectSubagents([
    { parts: [part("run-4", 1), part("run-5", 2), part("run-6", 3), part("run-7", 4)] },
  ])
  const times: Record<string, number> = { "run-4": 10, "run-5": 20, "run-6": 30, "run-7": 40 }
  const ordered = orderSubagents(refs, done, (ref) => times[ref.sessionID])
  assert.deepEqual(ordered.map((r) => r.sessionID), ["run-7", "run-6", "run-5", "run-4"])
})

test("a running subagent stays above newer finished ones", () => {
  const refs = collectSubagents([{ parts: [part("running", 1), part("finished", 2)] }])
  const statusOf = (ref: { sessionID: string }) =>
    ref.sessionID === "running" ? ("running" as const) : ("done" as const)
  const ordered = orderSubagents(refs, statusOf, (ref) => (ref.sessionID === "running" ? 1 : 99))
  assert.deepEqual(ordered.map((r) => r.sessionID), ["running", "finished"])
})

test("rows with no session data keep call order", () => {
  const refs = collectSubagents([{ parts: [part("c1", 1), part("c2", 2)] }])
  assert.deepEqual(orderSubagents(refs, done, () => undefined).map((r) => r.sessionID), ["c1", "c2"])
})

// A wave is one user turn: the prompt that delegated the batch.
const turn = (role: string, parts: unknown[]) => ({ message: { role }, parts: parts as never })
const done = () => "done" as const
const busy = () => "running" as const

test("one subagent in the only turn: one in the current batch", () => {
  const refs = collectSubagents([turn("user", []), turn("assistant", [part("c1")])])
  const current = visibleSubagents(refs, done)
  assert.equal(current.length, 1)
  assert.equal(refs.length, 1)
})

test("three in one turn, two finished: all three stay in the current batch", () => {
  const refs = collectSubagents([
    turn("user", []),
    turn("assistant", [part("c1", 1), part("c2", 2), part("c3", 3)]),
  ])
  const statusOf = (ref: { sessionID: string }) => (ref.sessionID === "c3" ? busy() : done())
  const current = visibleSubagents(refs, statusOf)
  assert.deepEqual(current.map((r) => r.sessionID), ["c1", "c2", "c3"])
  // Production always passes the row's own stamp; with none the call order
  // fallback applies and c3 stays on top as the only running one.
  assert.deepEqual(
    orderSubagents(current, statusOf, () => undefined).map((r) => r.sessionID),
    ["c3", "c1", "c2"],
  )
})

test("a new turn shows its own batch plus the subagent still working from the last one", () => {
  const refs = collectSubagents([
    turn("user", []),
    turn("assistant", [part("old-done", 1), part("old-running", 2)]),
    // The user asks again while old-running is still going.
    turn("user", []),
    turn("assistant", [part("new-1", 3), part("new-2", 4)]),
  ])
  const statusOf = (ref: { sessionID: string }) =>
    ref.sessionID === "old-running" || ref.sessionID === "new-2" ? busy() : done()
  const current = visibleSubagents(refs, statusOf)
  // The earlier finished one drops out; the earlier running one stays.
  assert.deepEqual(current.map((r) => r.sessionID), ["old-running", "new-1", "new-2"])
  // "All" still lists every one of them.
  assert.equal(refs.length, 4)
})

test("without a live status, a busy stamp newer than idle means still working", () => {
  // The cold-open case: no event reached this client, but the run stamps did.
  assert.equal(deriveSubagentStatus(stamped(10), undefined, undefined), "running")
  assert.equal(deriveSubagentStatus(stamped(10, 5), undefined, undefined), "running")
  // A run that started and then finished reads as done.
  assert.equal(deriveSubagentStatus(stamped(5, 10), undefined, undefined), "done")
})
