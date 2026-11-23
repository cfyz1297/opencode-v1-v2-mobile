// Guards the release upload path. The APK is handed to people, so the asset on
// a tag must be built from that tag's commit — not from a branch that happens
// to carry the same version string. Regression source: a workflow_dispatch on
// any branch could attach a production-signed build to an existing release,
// and the only check was `v(app.json version) == release_tag`, which a branch
// satisfies trivially. That is a supply-chain defect, not a cosmetic one: the
// signature and the version both look right.
//
// The step is inspected as a block, not as loose lines in the file: the first
// version of this test stayed green when the step was given `if: false`,
// `continue-on-error: true`, an `exit 0`, or was commented out — the "disable
// it once to unstick a release" move.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const workflow = readFileSync(new URL("../../.github/workflows/build.yml", import.meta.url), "utf8")

// shortcut: a text guard cannot prove the step's body is reachable — wrapping
// the `run:` block in `if false; then … fi` keeps every pinned line and the
// test green. Anyone who can edit build.yml already holds release authority, so
// the guard is a tripwire against accident, not against an attacker; upgrade by
// moving the body into scripts/bind-release.sh and exercising it with fake
// git/gh if that authority boundary is ever shared.

const BIND = "- name: Bind the APK to the tag's commit"
const UPLOAD = "- name: Attach the verified APK to the release"

// One step, from its own `- name:` to the next one. Slicing to the end of the
// file (or to a later step) let a decoy carry the pinned line while the real
// step was disabled, and let an unrelated step's `continue-on-error` fail this
// test.
function step(name: string): string {
  const steps = workflow.split(/\n(?= {6}- name: )/)
  const found = steps.find((chunk) => chunk.trimStart().startsWith(`- name: ${name}`))
  assert.ok(found, `step "${name}" must exist`)
  const index = steps.indexOf(found)
  assert.ok(index > 0, `step "${name}" must not be missing from the job`)
  return found
}

function bindStep(): string {
  const bind = step(BIND.replace("- name: ", ""))
  const upload = step(UPLOAD.replace("- name: ", ""))
  assert.ok(
    workflow.indexOf(bind) < workflow.indexOf(upload),
    "the bind step must run before the upload step",
  )
  return bind
}

// The exact condition, on both steps. Being liberal here is what failed before:
// `if: false`, `if: false # unstick`, `if: ${{ false }}` and a narrowed
// `if: inputs.release_tag != ''` all left the guard skipped while the upload
// still ran, and `always()` on the upload did the same when the guard failed.
// The condition is part of the control, so the test pins it verbatim.
const REAL_IF = /^\s*if: startsWith\(github\.ref, 'refs\/tags\/'\) \|\| inputs\.release_tag != ''\s*$/m

test("the bind and the upload run on exactly the same condition", () => {
  const bind = bindStep()
  assert.match(bind, REAL_IF, "the bind step must run wherever the upload runs")
  const upload = step(UPLOAD.replace("- name: ", ""))
  assert.match(upload, REAL_IF, "the upload step must not widen its condition past the guard")
  // The version guard inside the upload is the second door: `exit 0` there lets
  // an APK for 0.3.23 be clobbered onto the v0.3.24 release.
  assert.match(upload, /does not match the built \$EXPECTED_TAG.*exit 1/, "a tag/version mismatch must abort")
  assert.doesNotMatch(bind, /^\s*continue-on-error:/m, "a step allowed to fail does not gate the upload")
  assert.doesNotMatch(upload, /^\s*continue-on-error:/m, "nor does an upload allowed to fail")
})

test("the uploaded APK is bound to the tag's commit, not only to its version", () => {
  const step = bindStep()
  assert.match(step, /git rev-parse "\$RELEASE_TAG\^\{commit\}"/, "the tag's commit must be resolved")
  // Both ways an APK can get here: built in this run, or reused from an
  // earlier one. Each must be compared with that commit.
  assert.match(step, /BUILT_SHA=\$\(git rev-parse HEAD\)/, "a fresh build is identified by HEAD")
  assert.match(step, /actions\/runs\/\$REUSED_RUN.*head_sha/, "a reused APK is identified by its own run's head_sha")
  // Without this binding the reuse path silently falls back to HEAD, which
  // proves nothing about the APK that was actually downloaded.
  assert.match(step, /REUSED_RUN: \$\{\{ inputs\.reuse_apk_run_id \}\}/, "the reuse input must reach the step")
  assert.match(step, /"\$BUILT_SHA" != "\$TAG_SHA"/, "the comparison must be made")
  assert.match(step, /^\s*exit 1\s*$/m, "and a mismatch must abort the job, not continue to the upload")
  // An `exit 0` earlier in the block would make the `exit 1` unreachable while
  // every string above still matched — the "unstick it once" move again.
  assert.doesNotMatch(step, /^\s*exit 0\s*$/m, "nothing may exit successfully before the upload")
})

test("there is exactly one upload step to reason about", () => {
  // The guard above slices from the first upload step; a second one, with its
  // own condition, would publish the asset without passing the bind.
  const uploads = workflow.match(/gh release upload/g) ?? []
  assert.equal(uploads.length, 1, "a second upload path would bypass the guard")
})

test("the reuse check covers every prebuild and install input", () => {
  // plugins/ rewrites android/ during prebuild and .npmrc changes what npm ci
  // installs, so two branches differing only there produce different APKs
  // while the old list called them identical.
  const diff = workflow.match(/git diff --exit-code "\$SOURCE_SHA" HEAD -- ([^\n]+)/)
  assert.ok(diff, "the reuse path must diff the sources")
  for (const path of ["app", "src", "android", "assets", "plugins", "app.json", "package-lock.json", ".npmrc", "metro.config.js", "tsconfig.json"]) {
    assert.ok(
      diff[1].split(/\s+/).includes(path),
      `the reuse comparison must include ${path}: a difference there changes the built APK`,
    )
  }
})
