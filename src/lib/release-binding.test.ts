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
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const workflow = readFileSync(path.join(root, ".github/workflows/build.yml"), "utf8")
const script = path.join(root, "scripts/bind-release.sh")

const TAG_SHA = "1111111111111111111111111111111111111111"
const OTHER_SHA = "2222222222222222222222222222222222222222"

// A PATH with fake `git` and `gh` first: the script under test runs for real,
// but never touches a repository, the network or the GitHub API.
function sandbox(options: { tagSha?: string; fetchFails?: boolean; ghSha?: string; ghFails?: boolean }) {
  const dir = mkdtempSync(path.join(tmpdir(), "bind-release-"))
  const write = (name: string, body: string) => {
    const file = path.join(dir, name)
    writeFileSync(file, `#!/bin/sh\n${body}\n`)
    chmodSync(file, 0o755)
  }
  write(
    "git",
    `case "$1" in
  fetch) ${options.fetchFails ? "exit 128" : "exit 0"} ;;
  rev-parse) echo "${options.tagSha ?? TAG_SHA}" ;;
  *) exit 1 ;;
esac`,
  )
  write(
    "gh",
    options.ghFails ? "echo 'api error' >&2; exit 1" : `echo "${options.ghSha ?? TAG_SHA}"`,
  )
  return dir
}

function run(env: Record<string, string>, options = {}) {
  const dir = sandbox(options)
  return spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      PATH: `${dir}:${process.env.PATH ?? ""}`,
      GITHUB_REPOSITORY: "owner/repo",
      NODE_ENV: "test",
      ...env,
    },
  })
}

test("a fresh build of the tag's commit is allowed", () => {
  const result = run({ RELEASE_TAG: "v0.3.24", BUILT_COMMIT: TAG_SHA })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /matches v0\.3\.24/)
})

test("a build from another commit is refused", () => {
  const result = run({ RELEASE_TAG: "v0.3.24", BUILT_COMMIT: OTHER_SHA })
  assert.equal(result.status, 1, "a mismatch must fail the step, not warn")
  assert.match(result.stdout, /was built from 2222.*but v0\.3\.24 is 1111/)
})

test("a reused run is judged by its own commit, not by this checkout", () => {
  const ok = run({ RELEASE_TAG: "v0.3.24", REUSED_RUN: "42" }, { ghSha: TAG_SHA })
  assert.equal(ok.status, 0, ok.stderr)

  const bad = run({ RELEASE_TAG: "v0.3.24", REUSED_RUN: "42" }, { ghSha: OTHER_SHA })
  assert.equal(bad.status, 1)
  // A failing API call must not be read as a match.
  const apiDown = run({ RELEASE_TAG: "v0.3.24", REUSED_RUN: "42" }, { ghFails: true })
  assert.notEqual(apiDown.status, 0)
})

test("a tag whose name disagrees with the built version is refused", () => {
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

test("a missing record of the built commit fails closed", () => {
  // This is the shape a `git checkout` before the bind would have created if
  // the script read HEAD instead: the check must not silently pass.
  const result = run({ RELEASE_TAG: "v0.3.24" })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /BUILT_COMMIT is required/)
})

test("an unavailable tag fails closed", () => {
  const result = run({ RELEASE_TAG: "v9.9.9", BUILT_COMMIT: TAG_SHA }, { fetchFails: true })
  assert.notEqual(result.status, 0)
})

test("the workflow calls this script and records the commit before building", () => {
  assert.match(workflow, /^\s*bash scripts\/bind-release\.sh\s*$/m, "the step must run the tested script, not a copy of its logic")
  const record = workflow.indexOf('echo "BUILT_COMMIT=$(git rev-parse HEAD)" >> "$GITHUB_ENV"')
  const build = workflow.indexOf("- name: Build APK")
  const bind = workflow.indexOf("- name: Bind the APK to the tag's commit")
  assert.ok(record > 0, "the commit must be captured")
  assert.ok(record < build && build < bind, "captured before the build, which is before the bind")
})

test("there is exactly one way to publish to a release", () => {
  // Counting only `gh release upload` missed a second door: `gh release create`
  // or an `assets` POST through the API would publish without passing the bind.
  const publishes =
    workflow.match(/gh (?:release (?:upload|create|edit)|api[^\n]*\/releases\/[^\n]*\/assets)/g) ?? []
  assert.equal(publishes.length, 1, `one publish path, found: ${publishes.join(", ")}`)
})

test("no step can move HEAD between the build and the bind", () => {
  // The script no longer reads HEAD, so this is defence in depth: a checkout
  // here would be a sign someone re-introduced the old shape.
  const from = workflow.indexOf("- name: Build APK")
  const to = workflow.indexOf("- name: Bind the APK to the tag's commit")
  const between = workflow.slice(from, to)
  assert.doesNotMatch(between, /git\s+(checkout|switch|reset)/, "the build and the bind must see the same tree")
})
