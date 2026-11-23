// Guards the release upload path. The APK is handed to people, so the asset on
// a tag must be built from that tag's commit — not from a branch that happens
// to carry the same version string. Regression source: a workflow_dispatch on
// any branch could attach a production-signed build to an existing release,
// and the only check was `v(app.json version) == release_tag`, which a branch
// satisfies trivially. That is a supply-chain defect, not a cosmetic one: the
// signature and the version both look right.
//
// Plain `node --test`, no YAML parser dependency: the assertions are on the
// workflow text, the same way the other source-guard tests work.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const workflow = readFileSync(new URL("../../.github/workflows/build.yml", import.meta.url), "utf8")

// The upload step and everything before it, so an assertion cannot be satisfied
// by a line that runs after the APK is already published.
function beforeUpload(): string {
  const at = workflow.indexOf("gh release upload")
  assert.ok(at > 0, "the release upload step must exist")
  return workflow.slice(0, at)
}

test("the uploaded APK is bound to the tag's commit, not only to its version", () => {
  const text = beforeUpload()
  assert.match(text, /git rev-parse "\$RELEASE_TAG\^\{commit\}"/, "the tag's commit must be resolved")
  // Both ways an APK can get here: built in this run, or reused from an
  // earlier one. Each must be compared with that commit.
  assert.match(text, /BUILT_SHA=\$\(git rev-parse HEAD\)/, "a fresh build is identified by HEAD")
  assert.match(text, /actions\/runs\/\$REUSED_RUN.*head_sha/, "a reused APK is identified by its own run's head_sha")
  assert.match(text, /"\$BUILT_SHA" != "\$TAG_SHA"/, "the comparison must be made")
  assert.match(text, /Bind the APK to the tag's commit/, "and it must run before the upload")
})

test("the reuse check covers every prebuild input", () => {
  // plugins/ rewrites android/ during prebuild, so two branches that differ
  // only there produce different APKs while the old list called them identical.
  const diff = workflow.match(/git diff --exit-code "\$SOURCE_SHA" HEAD -- ([^\n]+)/)
  assert.ok(diff, "the reuse path must diff the sources")
  for (const path of ["app", "src", "android", "assets", "plugins", "app.json", "package-lock.json"]) {
    assert.ok(
      diff[1].split(/\s+/).includes(path),
      `the reuse comparison must include ${path}: a difference there changes the built APK`,
    )
  }
})
