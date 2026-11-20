import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-version-parity.mjs", import.meta.url));

// The script reads fixed relative paths, so each case gets its own directory and
// runs with `cwd` set there instead of chdir-ing the test process.
function fixture({ version = "1.2.3", code = 42, gradleCode = code, pkg = version, lock = version } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "version-parity-"));
  mkdirSync(path.join(dir, "android", "app"), { recursive: true });
  writeFileSync(
    path.join(dir, "app.json"),
    JSON.stringify({ expo: { version, android: { versionCode: code } } }),
  );
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: pkg }));
  writeFileSync(
    path.join(dir, "package-lock.json"),
    JSON.stringify({ version: lock, packages: { "": { version: lock } } }),
  );
  writeFileSync(
    path.join(dir, "android", "app", "build.gradle"),
    `android {\n    defaultConfig {\n        versionCode ${gradleCode}\n        versionName "${version}"\n    }\n}\n`,
  );
  return dir;
}

function run(dir) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [script], { cwd: dir, encoding: "utf8" }) };
  } catch (error) {
    return { code: error.status, out: String(error.stderr ?? "") };
  }
}

test("aligned metadata passes", () => {
  const result = run(fixture());
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /aligned: 1\.2\.3 \(42\)/);
});

test("a lockfile left at the previous release fails", () => {
  const result = run(fixture({ lock: "1.2.2" }));
  assert.equal(result.code, 1);
  assert.match(result.out, /package-lock\.json version 1\.2\.2 != app\.json version 1\.2\.3/);
});

test("a Gradle versionCode left at the previous release fails", () => {
  const result = run(fixture({ code: 42, gradleCode: 41 }));
  assert.equal(result.code, 1);
  assert.match(result.out, /Gradle versionCode 41 != app\.json versionCode 42/);
});
