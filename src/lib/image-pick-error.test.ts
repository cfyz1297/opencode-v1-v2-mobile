// expo-modules-core keeps activity-result launchers in a registry that drops
// each key when the Activity is destroyed and only re-registers at module
// creation, which happens once per process (AppContextActivityResultRegistry,
// Lifecycle.Event.ON_DESTROY -> unregister). Android recreating the Activity
// under a live process therefore leaves every expo picker dead until restart.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { isDeadLauncherError } from "./image-pick-error.ts"

// Copied from the alert a user reported: launch threw before any picker UI.
const REPORTED =
  "Call to function 'ExponentImagePicker.launchImageLibraryAsync' has been rejected.\n" +
  "→ Caused by: java.lang.IllegalStateException: Attempting to launch an unregistered " +
  "ActivityResultLauncher with contract expo.modules.imagepicker.contracts.ImageLibraryContract@ee72be9 " +
  "and input ImageLibraryContractOptions(...). You must ensure the ActivityResultLauncher is " +
  "registered before calling launch()"

test("a dead expo launcher is recognised from the wrapped rejection", () => {
  assert.equal(isDeadLauncherError(new Error(REPORTED)), true)
  assert.equal(isDeadLauncherError(REPORTED), true)
})

test("ordinary picker failures stay ordinary", () => {
  assert.equal(isDeadLauncherError(new Error("No Activity found to handle Intent")), false)
  assert.equal(isDeadLauncherError(new Error("User denied permissions")), false)
  assert.equal(isDeadLauncherError(undefined), false)
})

test("the source recognises it and stops retrying a launcher that cannot recover", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
  const src = readFileSync(path.join(root, "app/session/[id].tsx"), "utf8")
  // The legacy retry goes through the same dead registry.
  assert.match(src, /if \(isDeadLauncherError\(err\)\) throw err/)
  // And the user is told a restart is needed instead of "try another photo".
  assert.match(src, /alerts\.pickerRestartTitle/)
})
