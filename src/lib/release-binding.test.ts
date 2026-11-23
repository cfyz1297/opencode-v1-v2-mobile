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

const BIND = "- name: Bind the APK to the tag's commit"
const UPLOAD = "- name: Attach the verified APK to the release"

function bindStep(): string {
  const start = workflow.indexOf(BIND)
  assert.ok(start > 0, "the bind step must exist")
  const end = workflow.indexOf(UPLOAD, start)
  assert.ok(end > start, "the bind step must run before the upload step")
  return workflow.slice(start, end)
}

test("the bind step is a live step, not a disabled one", () => {
  const step = bindStep()
  assert.doesNotMatch(step, /^\s*#/m, "a commented-out step proves nothing")
  assert.doesNotMatch(step, /^\s*continue-on-error:/m, "a step allowed to fail does not gate the upload")
  // `if:` is legitimate here (the step must be skipped on a branch build), so
  // only a condition that can never hold is rejected.
  assert.doesNotMatch(step, /^\s*if:\s*false\s*$/m, "if: false disables the guard")
})

test("the uploaded APK is bound to the tag's commit, not only to its version", () => {
  const step = bindStep()
  assert.match(step, /git rev-parse "\$RELEASE_TAG\^\{commit\}"/, "the tag's commit must be resolved")
  // Both ways an APK can get here: built in this run, or reused from an
  // earlier one. Each must be compared with that commit.
  assert.match(step, /BUILT_SHA=\$\(git rev-parse HEAD\)/, "a fresh build is identified by HEAD")
  assert.match(step, /actions\/runs\/\$REUSED_RUN.*head_sha/, "a reused APK is identified by its own run's head_sha")
  assert.match(step, /"\$BUILT_SHA" != "\$TAG_SHA"/, "the comparison must be made")
  assert.match(step, /^\s*exit 1\s*$/m, "and a mismatch must abort the job, not continue to the upload")
})

test("the reuse check covers every prebuild and install input", () => {
  // plugins/ rewrites android/ during prebuild and .npmrc changes what npm ci
  // installs, so two branches differing only there produce different APKs
  // while the old list called them identical.
  const diff = workflow.match(/git diff --exit-code "\$SOURCE_SHA" HEAD -- ([^\n]+)/)
  assert.ok(diff, "the reuse path must diff the sources")
  for (const path of ["app", "src", "android", "assets", "plugins", "app.json", "package-lock.json", ".npmrc"]) {
    assert.ok(
      diff[1].split(/\s+/).includes(path),
      `the reuse comparison must include ${path}: a difference there changes the built APK`,
    )
  }
})
