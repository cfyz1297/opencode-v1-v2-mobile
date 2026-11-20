import { readFile } from "node:fs/promises";

const app = JSON.parse(await readFile("app.json", "utf8"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const gradle = await readFile("android/app/build.gradle", "utf8");

const name = gradle.match(/^\s*versionName\s+"([^"]+)"/m)?.[1];
const code = Number(gradle.match(/^\s*versionCode\s+(\d+)/m)?.[1]);
const expectedName = app.expo.version;
const expectedCode = app.expo.android.versionCode;

const errors = [];

if (pkg.version !== expectedName) {
  errors.push(`package.json version ${pkg.version} != app.json version ${expectedName}`);
}

// npm writes the package version into both places, and neither is read at
// runtime, so a mismatch only ever shows up as a stale number in the repo — but
// it is the copy a release checklist forgets.
for (const [label, value] of [
  ["package-lock.json version", lock.version],
  ['package-lock.json packages[""]', lock.packages?.[""]?.version],
]) {
  if (value !== expectedName) {
    errors.push(`${label} ${value ?? "missing"} != app.json version ${expectedName}`);
  }
}

if (name !== expectedName) {
  errors.push(`Gradle versionName ${name ?? "missing"} != app.json version ${expectedName}`);
}

if (code !== expectedCode) {
  errors.push(`Gradle versionCode ${Number.isNaN(code) ? "missing" : code} != app.json versionCode ${expectedCode}`);
}

// A versionCode left at the previous release's value is the silent half of this
// failure: the metadata is internally consistent and CI installs fine, but every
// direct-APK install keys upgrades off versionCode, so a new APK carrying the
// previous release's code is never offered to the user. The workflow asserts the
// built APK carries this exact code; keep the code a release-only change.
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Version metadata aligned: ${expectedName} (${expectedCode})`);
}
