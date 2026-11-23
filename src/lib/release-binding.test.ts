// The release bind is guarded by BEHAVIOUR, not by text.
//
// An earlier version of this test matched strings in build.yml, and five review
// rounds each found a form it could not see: `if false; then … fi` wrapped
// around the body, a `git checkout` that moved HEAD to the tag while the APK
// stayed a branch build, a second publish step, `BUILT_SHA=$TAG_SHA`. All of
// them left the suite green. The guard now lives in scripts/bind-release.sh and
// this test runs it against fake `git` and `gh`, so the assertion is its exit
// code — something a text match cannot fake.
//
// The structural pins below stay, but only for what they can honestly prove:
// the workflow must call the script, must capture the commit before it can be
// moved, and must have exactly one publish call.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Only this test spawns a shell and relies on extensionless executables in
// PATH; on Windows that is not how processes resolve, and the rest of the suite
// is cross-platform on purpose. CI runs Linux, where the guard matters.
const skipOnWindows = process.platform === "win32" ? "needs bash and a POSIX PATH" : false

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const workflow = readFileSync(path.join(root, ".github/workflows/build.yml"), "utf8")
const script = path.join(root, "scripts/bind-release.sh")

const TAG_SHA = "1111111111111111111111111111111111111111"
const OTHER_SHA = "2222222222222222222222222222222222222222"

// A PATH with fake `git` and `gh` first: the script under test runs for real,
// but never touches a repository, the network or the GitHub API.
//
// The fake git refuses any rev-parse but the tag's own peeled form. Answering
// every argument with TAG_SHA made the suite blind to the original defect:
// `git rev-parse HEAD` instead of `git rev-parse "$RELEASE_TAG^{commit}"` passed
// every test, and would let a branch build be published as the tag's.
function sandbox(options: {
  tagSha?: string
  fetchFails?: boolean
  ghSha?: string
  ghFails?: boolean
  ghShaFails?: boolean
  runEvent?: string
}) {
  const dir = mkdtempSync(path.join(tmpdir(), "bind-release-"))
  const write = (name: string, body: string) => {
    const file = path.join(dir, name)
    writeFileSync(file, `#!/bin/sh\n${body}\n`)
    chmodSync(file, 0o755)
  }
  const sha = options.tagSha ?? TAG_SHA
  write(
    "git",
    `echo "$1 $2" >> "${dir}/calls.log"
case "$1" in
  fetch) ${options.fetchFails ? "exit 128" : "exit 0"} ;;
  rev-parse)
    case "$2" in
      'v0.3.24^{commit}'|'v9.9.9^{commit}') echo "${sha}" ;;
      *) echo "fake git: unexpected rev-parse argument '$2'" >&2; exit 128 ;;
    esac ;;
  *) echo "fake git: unexpected command '$1'" >&2; exit 1 ;;
esac`,
  )
  write(
    "gh",
    options.ghFails
      ? "echo 'api error' >&2; exit 1"
      : `case "$*" in
  *".event"*) echo "${options.runEvent ?? "push"}" ;;
  *".head_sha"*) ${options.ghShaFails ? "echo 'api error' >&2; exit 1" : `echo "${options.ghSha ?? sha}"`} ;;
  *) echo "${options.ghSha ?? sha}" ;;
esac`,
  )
  return dir
}

type Sandbox = Parameters<typeof sandbox>[0] | undefined

function run(env: Record<string, string>, options: Sandbox = undefined) {
  const dir = sandbox(options ?? {})
  const result = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...(process.env as Record<string, string>),
      PATH: `${dir}:${process.env.PATH ?? ""}`,
      GITHUB_REPOSITORY: "owner/repo",
      ...env,
    } as unknown as NodeJS.ProcessEnv,
  })
  return Object.assign(result, { calls: () => readFileSync(path.join(dir, "calls.log"), "utf8") })
}

test("a fresh build of the tag's commit is allowed", { skip: skipOnWindows }, () => {
  const result = run({ RELEASE_TAG: "v0.3.24", BUILT_COMMIT: TAG_SHA })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /matches v0\.3\.24/)
})

test("a build from another commit is refused", { skip: skipOnWindows }, () => {
  const result = run({ RELEASE_TAG: "v0.3.24", BUILT_COMMIT: OTHER_SHA })
  assert.equal(result.status, 1, "a mismatch must fail the step, not warn")
  assert.match(result.stdout, /was built from 2222.*but v0\.3\.24 is 1111/)
})

test("a reused run is judged by its own commit, not by this checkout", { skip: skipOnWindows }, () => {
  const ok = run({ RELEASE_TAG: "v0.3.24", REUSED_RUN: "42" }, { ghSha: TAG_SHA })
  assert.equal(ok.status, 0, ok.stderr)

  const bad = run({ RELEASE_TAG: "v0.3.24", REUSED_RUN: "42" }, { ghSha: OTHER_SHA })
  assert.equal(bad.status, 1)
  // A failing API call must not be read as a match — on either request. The
  // `.event` read comes first, so a failure there hid the same defect on the
  // `.head_sha` read that actually decides.
  const apiDown = run({ RELEASE_TAG: "v0.3.24", REUSED_RUN: "42" }, { ghFails: true })
  assert.notEqual(apiDown.status, 0)
  const shaDown = run({ RELEASE_TAG: "v0.3.24", REUSED_RUN: "42" }, { ghShaFails: true })
  assert.notEqual(shaDown.status, 0, "an unreadable head_sha must not pass as a match")
})

test("a reused run must be a push build, not another reuse", { skip: skipOnWindows }, () => {
  // A dispatch can carry an APK from an earlier run, so its head_sha says
  // nothing about that APK. Chaining two dispatches would publish a build whose
  // commit was never compared with the tag.
  const chained = run({ RELEASE_TAG: "v0.3.24", REUSED_RUN: "42" }, { runEvent: "workflow_dispatch" })
  assert.equal(chained.status, 1)
  assert.match(chained.stdout, /not a push build/)

  const push = run({ RELEASE_TAG: "v0.3.24", REUSED_RUN: "42" }, { runEvent: "push" })
  assert.equal(push.status, 0, push.stderr)
})

test("a tag whose name disagrees with the built version is refused", { skip: skipOnWindows }, () => {
  // The commit check cannot see this: a tag can point at a commit whose
  // app.json carries another version, and the APK would land on the wrong
  // release. The workflow computes EXPECTED_TAG from app.json and exports it.
  const wrong = run({ RELEASE_TAG: "v0.3.24", BUILT_COMMIT: TAG_SHA, EXPECTED_TAG: "v0.3.23" })
  assert.equal(wrong.status, 1)
  assert.match(wrong.stdout, /does not match the built v0\.3\.23/)

  const right = run({ RELEASE_TAG: "v0.3.24", BUILT_COMMIT: TAG_SHA, EXPECTED_TAG: "v0.3.24" })
  assert.equal(right.status, 0, right.stderr)

  // The workflow must actually export it, or the check silently does nothing.
  assert.match(workflow, /export EXPECTED_TAG=/, "the version guard must reach the script")
})

test("a missing record of the built commit fails closed", { skip: skipOnWindows }, () => {
  // This is the shape a `git checkout` before the bind would have created if
  // the script read HEAD instead: the check must not silently pass.
  const result = run({ RELEASE_TAG: "v0.3.24" })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /BUILT_COMMIT is required/)
})

test("the tag is fetched before it is trusted", { skip: skipOnWindows }, () => {
  // A local ref is not evidence: it may be stale or never exist on the remote.
  // Replacing the fetch with `true` used to keep every test green, because the
  // fake answered rev-parse for any known tag.
  const result = run({ RELEASE_TAG: "v0.3.24", BUILT_COMMIT: TAG_SHA })
  assert.equal(result.status, 0, result.stderr)
  const calls = result.calls().trim().split("\n")
  const fetch = calls.findIndex((line) => line.startsWith("fetch "))
  const resolve = calls.findIndex((line) => line.startsWith("rev-parse "))
  assert.ok(fetch >= 0, "the script must fetch the tag")
  assert.ok(resolve > fetch, "and fetch it before resolving the commit")
})

test("a tag that is not on the remote fails closed, not on the rev-parse", { skip: skipOnWindows }, () => {
  // The fake accepts v9.9.9's peeled form on purpose: if the fetch guard were
  // replaced with `|| true`, the script would read a stale local ref and pass.
  const result = run({ RELEASE_TAG: "v9.9.9", BUILT_COMMIT: TAG_SHA }, { fetchFails: true })
  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /not on the remote/, "the fetch must be what refuses, not the rev-parse after it")
})

test("the guard cannot be skipped, failed-open or reordered", () => {
  // The script proves the comparison. These pins prove the step that runs it
  // still runs: a skipped step, a tolerated failure or a later position all
  // publish the APK without the comparison ever executing.
  const CONDITION = /^\s+if: startsWith\(github\.ref, 'refs\/tags\/'\) \|\| inputs\.release_tag != ''\s*$/gm
  const conditions = workflow.match(CONDITION) ?? []
  assert.equal(conditions.length, 2, "the bind and the upload share one condition, and nothing else on the line")

  const bind = workflow.indexOf("- name: Bind the APK to the tag's commit")
  const upload = workflow.indexOf("- name: Attach the verified APK to the release")
  assert.ok(bind > 0 && upload > bind, "the bind must run before the upload")

  const tagExpression = /RELEASE_TAG: \$\{\{ inputs\.release_tag \|\| github\.ref_name \}\}/g
  assert.equal(
    (workflow.match(tagExpression) ?? []).length,
    2,
    "the bind and the upload must derive the same tag",
  )

  const guarded = workflow.slice(bind, upload + 400)
  assert.doesNotMatch(guarded, /continue-on-error:/, "neither step may be allowed to fail")
  // Any status function removes the implicit success(); the anchored condition
  // above already rules it out, this names the intent.
  assert.doesNotMatch(guarded, /always\(\)|failure\(\)|cancelled\(\)/, "no status function may bypass the implicit success()")
})

test("the bind step receives exactly the inputs its logic reads", () => {
  const step = workflow.slice(workflow.indexOf("- name: Bind the APK to the tag's commit"))
  const block = step.slice(step.indexOf("env:"), step.indexOf("run: |"))
  const keys = [...block.matchAll(/^\s{10}([A-Z_]+):/gm)].map((m) => m[1])
  // Dropping REUSED_RUN made the bind judge this checkout while the APK came
  // from another run; adding BUILT_COMMIT here would override the value recorded
  // before the build.
  assert.deepEqual(keys, ["GH_TOKEN", "RELEASE_TAG", "REUSED_RUN"])
})

test("the bind step's whole body is exactly the call", () => {
  const step = workflow.slice(workflow.indexOf("- name: Bind the APK to the tag's commit"))
  const body = step.slice(step.indexOf("run: |") + "run: |".length).split("\n\n")[0]
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
  assert.deepEqual(lines, [
    "set -euo pipefail",
    `export EXPECTED_TAG="v$(node -p "require('./app.json').expo.version")"`,
    "bash scripts/bind-release.sh",
  ], "no wrapper, no early exit, no inline copy of the logic")
})

test("the workflow calls this script and records the commit before building", () => {
  assert.match(workflow, /^\s*bash scripts\/bind-release\.sh\s*$/m, "the step must run the tested script, not a copy of its logic")
  const record = workflow.indexOf('echo "BUILT_COMMIT=$(git rev-parse HEAD)" >> "$GITHUB_ENV"')
  const build = workflow.indexOf("- name: Build APK")
  const bind = workflow.indexOf("- name: Bind the APK to the tag's commit")
  assert.ok(record > 0, "the commit must be captured")
  assert.ok(record < build && build < bind, "captured before the build, which is before the bind")
})

test("a failed bind does not still hand out the rejected APK as an artifact", () => {
  // The artifact is the second way an APK leaves the runner. It stood ABOVE the
  // bind, so `steps.bind.outcome` did not exist yet, the comparison read as
  // '' != 'failure', and the rejected APK was uploaded anyway.
  const artifact = workflow.indexOf("- name: Upload APK artifact")
  const bind = workflow.indexOf("- name: Bind the APK to the tag's commit")
  assert.ok(artifact > 0 && bind > 0)
  assert.ok(artifact > bind, "the artifact step must come after the bind it depends on")
  // Without an `if:` the step runs on success only, which is what is wanted: a
  // skipped bind (branch run) still uploads, a failed one does not.
  const block = workflow.slice(artifact, workflow.indexOf("- name:", artifact + 10))
  assert.doesNotMatch(block, /^\s*if:/m, "an explicit condition here was the bug: it evaluated before the bind")
})

test("the documented reuse input matches what the gate enforces", () => {
  // The input hint is the only place an operator learns the rule. It said "any
  // successful run" after the script began rejecting everything but a push run,
  // so the advice pointed at runs the gate refuses.
  // YAML doubles an inner quote; capture the raw scalar and unescape it.
  const raw = workflow.match(/reuse_apk_run_id:\n\s+description: '((?:[^']|'')+)'/)?.[1] ?? ""
  const description = raw.replace(/''/g, "'")
  assert.match(description, /push/i, "the hint must say which runs are accepted")
  // The gate compares the run's commit with the tag's, not its file list; the
  // old wording ("sources must match") promised a weaker rule and would have
  // sent an operator to a run the gate rejects.
  assert.match(description, /this tag's commit/, "the hint must state the commit rule")
  assert.match(description, /dispatch and pull_request/, "and which runs are refused, and why")
})

test("there is exactly one way to publish to a release", () => {
  // Counting only `gh release upload` missed a second door: `gh release create`
  // or an `assets` POST through the API would publish without passing the bind.
  // Any client: `gh release upload`, `gh release create`, or a REST call to the
  // assets endpoint. A `curl` POST used to be invisible here.
  const publishes = workflow.match(/^[^\n]*(?:\/releases\/[^\n]*\/assets|gh release (?:upload|create|edit))\S*/gm) ?? []
  assert.equal(publishes.length, 1, `one publish path, found: ${publishes.join(", ")}`)
})

test("no step can move HEAD between recording the commit and the bind", () => {
  // The script reads BUILT_COMMIT, not HEAD, so this is defence in depth. The
  // slice starts at the record step on purpose: a checkout between recording
  // and building would leave BUILT_COMMIT at the tag while the APK is a branch
  // build — the very shape this guard exists to stop.
  const from = workflow.indexOf('echo "BUILT_COMMIT=$(git rev-parse HEAD)" >> "$GITHUB_ENV"')
  const to = workflow.indexOf("- name: Bind the APK to the tag's commit")
  assert.ok(from > 0, "the record step must exist")
  const between = workflow.slice(from, to)
  assert.doesNotMatch(between, /git\s+(checkout|switch|reset)/, "the build and the bind must see the same tree")
})
