# OpenCode V1/V2 Mobile (cfyz1297 fork)

**English** | [Русский](README.ru.md)

> **Android app for the OpenCode AI coding agent.** Drive your `opencode serve` sessions from a phone: live transcript, tool approvals, diffs, model and reasoning-effort switching — over LAN, Tailscale or a tunnel. Works with **opencode 1.x (V1 API) and 2.x (V2 API), auto-detected.**

A fork of [dzianisv/opencode-mobile](https://github.com/dzianisv/opencode-mobile), built with Expo/React Native. Distributed as an APK from GitHub Releases only — no app stores, no account, no backend of its own: the app talks straight to your server.

The repository used to be called `opencode-mobile`; it was renamed to `opencode-v1-v2-mobile` in 0.3.0. Old links redirect, and the APK file name (`opencode-mobile-v2.apk`) is kept unchanged so the built-in update check and the release signature chain keep working.

Version **0.3.4 (69)**. Installs over 0.3.3 — no uninstall needed.

> **Status:** every build runs 657 automated tests plus an Android CUA smoke on an emulator. Not yet exercised against a real opencode 1.18.x server, and the tablet layout, tunnel wizard and offline history have been checked in code and on the emulator only.

## Is this the app you are looking for?

| You want… | This repo |
|---|---|
| An Android client for **opencode 2.x** (V2 API, `/api/*`) | yes |
| An Android client for **opencode 1.x** (V1 API, `npm i -g opencode-ai`) | yes — the same APK |
| One app for **both**, switching automatically | yes, with a manual override |
| A phone client for a server in **Termux**, on a laptop or a VPS | yes (LAN, Tailscale, Cloudflare, ngrok) |
| Approve tools, read diffs, stop a run from the phone | yes |
| No telemetry, no account, no Play Store | yes — APK from Releases only |
| An iOS build | no (upstream removed it from this fork's scope) |

Related projects: [dzianisv/opencode-mobile](https://github.com/dzianisv/opencode-mobile) (upstream, V1 only), [sst/opencode](https://github.com/sst/opencode) (the agent itself), `opencode serve` in Termux on Android.

**Keywords:** opencode android client · opencode mobile · opencode v2 api android · opencode 1.x client · remote control AI coding agent from phone · opencode serve Tailscale · react native opencode · coding agent mobile app.

## Install (Android, APK)

Stable link — always the latest release:

- **[Download opencode-mobile-v2.apk](https://github.com/cfyz1297/opencode-v1-v2-mobile/releases/latest/download/opencode-mobile-v2.apk)** (~86 MB)
- All releases: [Releases](https://github.com/cfyz1297/opencode-v1-v2-mobile/releases) — every new build gets its own release (`0.2.15`, `0.2.18`, `0.3.0`, …). The APK file is still named `opencode-mobile-v2.apk`: the release signature check and the update-check link both point at that name, so it is deliberately not renamed.

> ⚠️ One-time reinstall: since `0.2.9` the APK is signed with a permanent key (earlier every build generated a new debug key, so updates would not install over the old app). If you are on an older build, uninstall it **once** and install the current one; after that updates install in place.

The APK is built by GitHub Actions from `main` of this repository and signed with a permanent key from the repository secrets (a debug key is used when the secret is missing). Google Play / F-Droid / App Store — not used: those workflows are disabled. Only `Build Android APK` and `Security scan` are active.

## Connecting to an opencode server

The app speaks **both server generations**: opencode 1.x (V1 API, what `npm install -g opencode-ai` still installs) and opencode 2.0.x+ (V2 API, installed as a native binary). It probes the address once, remembers the answer per connection, and uses the matching transport — `/global/health` + `/global/event` for V1, `/api/info` + `/api/event` for V2. The probe classifies by response envelope, never by status code: an unknown route on either generation falls through to the web UI and answers `200 text/html`, which is why a V2-only client used to report "connected" on a V1 server and then fail on every request.

If auto-detection ever picks wrong, **Settings → Server → Server API** forces `v1` or `v2` for the active connection.

For V2:

1. Install and start the server:

   ```bash
   curl -fsSL https://opencode.ai/v2/install | bash
   OPENCODE_SERVER_PASSWORD=yourpassword opencode serve --hostname 0.0.0.0 --port 4096
   ```
2. In the app: **Add Connection** → server address (`http://IP:4096`), user `opencode`, password from the command above.

**On Android**, the server is [opencode-termux](https://github.com/cfyz1297/opencode-termux): OpenCode 2 compiled for Bionic, so it runs inside Termux with no glibc, no proot and no compatibility layer.

```bash
curl -fsSL https://raw.githubusercontent.com/cfyz1297/opencode-termux/main/install.sh | bash
OPENCODE_SERVER_PASSWORD=yourpassword opencode serve --hostname 0.0.0.0 --port 4096
```

`opencode upgrade` (or re-running the install command) updates it. Builds from `2.2.5-r1` include the fix for the TUI crash on Android 17 (`Pointer exceeds safe integer range`); the server API is the same as the official V2 binary.

V2 specifics (verified on 2.0.27): Basic authentication only as `opencode:<password>` (Bearer and an empty user both return 401), all paths under `/api/*`, paginated responses as `{data, cursor}`, SSE at `GET /api/event`.

## What the app does

**Sessions and chat**
- Live transcript: text, reasoning, tool calls, diffs and compaction summaries, streamed as the server produces them, in the order the model produced them.
- Send a follow-up while the agent is still working; the server queues it.
- Stop button follows the server's actual run status, so a run started elsewhere (app restarted, another device, opened mid-run) can still be interrupted.
- Edit a message and roll the session back to it (`revert` / `unrevert`), or compact the history into a summary.
- Pending tool approvals and agent questions appear inline; answered questions stay in the transcript collapsed to one line.
- A failed run shows the server's reason in place of the answer instead of an empty bubble.
- Message page size is counted in prompts (5 / 10 / 25 / 50 / **All**). "All" loads the whole transcript.

**Session info**
- The header button is a ring filled by context usage (blue, amber past 50 %, red past 80 %).
- The panel shows token counts, the context percentage with a bar, the total spend for the whole session, and the model/agent the session runs with.

**Models and agents**
- Model picker with search, grouped by provider, showing the active model.
- **Favorites**: a star in either picker pins a model to a "Favorites" section on top; stored on the device only, shared across connections.
- Hidden models (Models screen) disappear from both pickers.
- Reasoning-effort (variant) picker for models that expose one; the sheets move with the keyboard so no row is left under the IME.

**Connections and servers**
- Multiple connections: LAN, Tailscale, tunnel; passwords in the Keystore/Keychain.
- **V1 and V2 support** with automatic detection and a manual override.
- Honest status: "Active" means the server answered, checked on focus, every 15 s and on foreground.
- Tunnel wizard for Cloudflare (named tunnels) and ngrok.
- Providers screen: connect a provider by API key through the server; no key is stored in the APK.
- Diagnostics screen with a copyable report (URL parsing, both health routes, the detected API generation, internet reachability).

**Reliability and privacy**
- Streak recovery: stream watchdog, transcript re-read after silence, `GET /api/session/active` to settle "working" state.
- Offline history, encrypted, read-only, capped.
- No telemetry: Sentry and PostHog are removed.
- Biometric unlock, notifications with fixed text (no server-supplied tool names or paths on the lock screen).
- Tablet layout, any orientation, native keyboard inset.

## How the fork differs from upstream

The base is upstream [dzianisv/opencode-mobile](https://github.com/dzianisv/opencode-mobile) at tag `v0.4.15` (2026-08-14). From there the fork has its own version line and its own goals: one user, one server in Termux, one delivery channel — an APK.

| What | Upstream | Fork |
|---|---|---|
| Server API | API 1.x only (`/session`, `/global/*`) | **both**: 1.x (`/session`, `/global/*`) and 2.x (`/api/*`), auto-detected, forceable in Settings |
| Version | 0.4.x | fork's own 0.3.x line, currently 0.3.4 (69) |
| Signing and updates | new debug key per build in old versions | permanent keystore, installs in place |
| Channels | Google Play, self-hosted F-Droid, APK, EAS | APK from GitHub Releases only |
| Telemetry | Sentry (crash reports) + PostHog | both dependencies removed |
| Languages | English, 简体中文 | + Russian (en / ru / zh-Hans with key parity check) |
| Orientation | portrait only | any, tablet layout from 768 dp, two panes from 1000 dp |
| Offline history | planned | available, encrypted with Keystore/Keychain |
| Tunnel wizard | beta | Cloudflare (named tunnels) and ngrok, built-in wizard |
| Models screen | none | search, groups, visibility — affects both pickers |
| Connection status | "selected" means "active" | real server response, polled on focus and every 15 s |
| Run recovery | none | silence watchdog, transcript re-read, `GET /api/session/active` |
| Model picker | search + groups | + favorites (starred section on top) |
| Session info | token count | context ring in the header, context bar, whole-session spend |
| Sessions list | newest page | walks the server cursor, up to 800 roots |
| Tool rows | name + raw payload | command for `shell`, live progress title, input fallback, no empty expand |
| Keyboard | JS inset | native IME inset in `MainActivity` |
| New session folder | default | the selected project (`location.directory` in the request body) |
| Tests | `node --test` over a glob | `scripts/run-tests.mjs` + 80 % coverage gate, CUA smoke on an emulator |

What changed in the code:

- **Adapter `src/lib/v2-compat.ts`**: V2 responses and events are normalized to the V1 shape, so stores and screens stayed as they were. V1 events (`session.status`, `message.part.updated`) are assembled from V2 deltas (`session.text.delta`, `session.reasoning.delta`, `session.tool.*`).
- **SDK** switched to `/api/session`, `/api/event`, `/api/info`, `/api/permission/request`, `/api/fs/*`, `/api/project`, `/api/location`. Changing a session's model/agent goes through `POST /api/session/{id}/model` and `/agent`.
- **V1 transport** (`src/lib/sdk-v1.ts`, `src/lib/api-detect.ts`): the same app works against an opencode 1.x server — `/session`, `/experimental/session`, `/session/{id}/prompt_async`, `/global/event`. The detected API is stored on the connection (`api`, `serverVersion`) and is invalidated when the URL changes. Ported from upstream PR #209 / release v0.4.16.
- **Tool cards** (`src/lib/tool-view.ts`): the `shell` tool (2.x name) is rendered as a terminal with its command, the progress title from `session.tool.progress` is shown, and an empty output falls back to the tool input instead of an empty card.
- **Session stats** (`src/lib/session-stats.ts`, `src/components/chat/ContextRing.tsx`): one function computes tokens, context percentage and whole-session cost, shared by the header ring and the info panel so they cannot disagree.
- **New screens and logic**: `app/history.tsx` (offline history), `app/models.tsx` (model visibility), `app/providers/*` (provider catalog and key-based connection through the server), `app/connection/tunnel.tsx` (tunnel wizard), `src/components/TabletSessions.tsx` (tablet), `src/lib/adaptive-layout.ts`, `src/lib/connection-health.ts`, `src/lib/connection-security.ts`, `src/lib/run-watchdog.ts`, `src/lib/stream-watchdog.ts`, `src/lib/keyboard-inset.ts`, `src/lib/message-page.ts` (page in prompts, `ALL_TURNS`, `keepLoadedHistory`), `src/lib/session-stats.ts`, `src/lib/tool-view.ts`, `src/lib/api-detect.ts`, `src/stores/model-favorites.ts`.
- **V2 specifics**: agent questions go through V2 forms, compaction summaries are visible in the transcript, image attachments render as images, the chat follows the stream, the composer clears after a built-in command.
- **Client isolation**: the SDK client is bound to its connection, so streamed messages and the selected model do not leak between servers.
- **Removed along with the infrastructure**: `website/`, `docs-site/`, `fastlane/`, `fdroid/`, `distribution/`, `eas.json`, `.maestro/`, `.autopilot/`, `.supervisor/`, `.tasks/`, the iOS build and store-publishing workflows, the Sentry plugin and source-map upload.
- **Security**: the `SYSTEM_ALERT_WINDOW` permission is blocked, passwords and offline copies are written with the `WHEN_UNLOCKED_THIS_DEVICE_ONLY` policy, and the connection form warns about a password over unencrypted `http://`. Approval and question notifications carry fixed text, not server-supplied tool names, paths or question bodies, because the notification shade is readable on a locked phone (upstream audit M-03, ported). Requests carry `ngrok-skip-browser-warning` / `Bypass-Tunnel-Reminder`, so a tunnel proxies the API instead of answering with its own interstitial page.

What the fork does not have (by design or not yet): provider OAuth connections (API key only), OpenCode Cloud, iOS builds, stores and telemetry.

## What is kept from upstream

Demo mode without a server, multiple connections (LAN, tunnel, Tailscale), biometric unlock, streaming chat, diff viewer, tool-call approval, agent questions, secure password storage, notifications, a new-version banner. See the [upstream README](https://github.com/dzianisv/opencode-mobile#readme) for details.

## Security

- Server passwords and offline history live in the Android Keystore / iOS Keychain with the `WHEN_UNLOCKED_THIS_DEVICE_ONLY` policy: they do not end up in OS backups and are not restored on another device.
- Plain `http://` encrypts neither the password nor the transcript. The connection forms warn about it; use https, a tunnel or Tailscale on untrusted networks. Loopback (Termux on the same phone) shows no warning — traffic never leaves the device.
- The app does not request `SYSTEM_ALERT_WINDOW` (drawing over other apps).
- Build dependencies: `npm audit` reports 34 entries (7 high) in the Metro/PostCSS/Expo CLI chain. `npm audit fix --force` downgrades Expo to 51 and breaks the project. None of that code ships in the APK — it only runs during the CI build.

## Cloudflare / ngrok wizard

Cloudflare needs a **named tunnel**, an account and a domain: in the Cloudflare dashboard create a Tunnel and a Published application route with the Service URL `http://127.0.0.1:4096`, then run the command with the token on your computer. The Cloudflare token is never entered in the app. Quick `trycloudflare.com` addresses are rejected by the wizard: [they do not support SSE](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/#limitations), which streaming replies require. The alternative without your own domain is ngrok. Installing cloudflared/ngrok and logging into ngrok is done by the computer's owner.

## Building from source

```bash
git clone https://github.com/cfyz1297/opencode-v1-v2-mobile
cd opencode-mobile
npm install
npm run android            # dev build on a device/emulator
```

The release APK is built by GitHub Actions (`.github/workflows/build.yml`) on every push to `main` and on `v*` tags: tests, typecheck and version parity first, then `expo prebuild` + `gradlew assembleRelease`. The artifact is `app-release`; the GitHub release with the APK is published manually.

Tests (Node.js 24+): `npm test`. Total coverage with an 80 % gate: `npm run test:coverage`. Typecheck: `npm run typecheck`. Versions in `package.json`, `app.json` and `android/app/build.gradle`: `npm run check:versions`.

The build includes an Android CUA smoke: the release APK, wizard commands, rejection of HTTP before any network access, switching between sessions in two panes, window resizing, a cold restart without a server, reading and clearing history. The `roadmap-smoke-evidence` artifact holds screenshots and the result.

Security review and the reasoning behind the fixes: [docs/security-review-0.2.21.md](docs/security-review-0.2.21.md), connection status: [docs/connection-status-validation.md](docs/connection-status-validation.md), model visibility: [docs/model-visibility-validation.md](docs/model-visibility-validation.md), run recovery: [docs/run-resync-validation.md](docs/run-resync-validation.md). Current project state and the release order: [HANDOFF.md](HANDOFF.md).

A separate pure-Java client without Gradle (`aapt → ecj → d8 → apksigner`), also on the V2 API, lives in another repository.

## Updates

<details>
<summary>Changelog by version (0.2.11 - 0.3.4)</summary>

### 0.3.4

- **Chat text is drawn cleanly.** Inline code was highlighted with a background bar. On Android that bar is placed from the code span's own box, so for a span that wraps the bar is taller than its line and covers the letters above it, and a code span with a smaller font shifts its bar about half a line down. Reproduced on an Android 15 emulator with several style variants: the bars misplace in all of them while the glyphs are correct, so the background itself was the defect. Inline code now keeps the code colour and a monospace family only.
- **The model and effort pickers no longer come up empty.** The provider catalog loaded once per connection; if that request landed while the phone was locked or the server unreachable, both sheets stayed blank until Settings → Models reloaded it. A failed fetch now keeps the list already loaded (per connection, so another server's models never leak in), returning to the app refreshes it, and opening the picker with an empty catalog fetches again first.

### 0.3.3

- **The update notice works again.** Opening the release page now marks that version as seen and hides the strip — `Linking.openURL` resolves to `void`, so the previous check never dismissed it. The banner also re-checks when the app returns to the foreground, and the About row refreshes every time Settings is opened, instead of only on the first mount.
- **An answer received while backgrounded no longer re-types itself.** On return the app replaces the SSE stream before refreshing the transcript, so the backlog of buffered deltas is dropped instead of replaying older, shorter snapshots over the complete answer. Text and reasoning parts additionally only grow while a run streams; a stale delta can no longer shrink them.
- **A long background no longer hangs the session.** Android can kill the event socket without an error while JS is suspended, and the stall watchdog only watched active runs, so a resumed app could stay silent until the next prompt waited out 30 seconds. Returning after 15+ seconds in the background now opens a fresh stream and re-syncs the open session, the busy state and pending permission/question forms. A quick app switch keeps the existing stream.

### 0.3.2

- **Connection editing keeps the right API version.** "Test connection" now survives Save, and saving the same address re-probes it, so swapping a V1 server for V2 on the same URL no longer leaves a stale protocol recorded. An auth rejection on `/api/info` no longer counts as proof of V2 — a password-protected V1 server answers the same way.
- **Voice input uses the phone's real locale.** `ru-RU` and `zh-CN` reach the recognizer unchanged instead of being rewritten to `ru-US` / `zh-US`.
- **Localized chat and notifications.** Message role labels and system notification titles/bodies follow en / ru / zh-Hans; server-supplied text still never reaches the lock screen.
- **Tests are typechecked.** `*.test.ts(x)` are back in `tsconfig.json`, and the 49 test-type errors this exposed are fixed.
- **Leaner CI and build.** `versionCode` / `versionName` are read from `app.json`, the signing certificate is compared with a pinned SHA-256 instead of downloading the previous 86 MB APK, and the assembled APK is checked for `SYSTEM_ALERT_WINDOW` and `debuggable`.
- **Security fixes.** Diagnostics no longer log or share credentials embedded in a URL; a session id from a deep link or notification is validated before it reaches an API path. Full report: `docs/security-review-0.3.2.md`.
- **Fewer round trips and writes.** Model and agent switches run in parallel; switching the active connection writes SecureStore once.
- **Removed:** `@tanstack/react-query`, the `agentlabs.cc` waitlist form and retry queue, the dead Chatwoot client, `android/sentry.properties`, and the dev network-inspector flag in release builds. Shared HTTP, stored-JSON parsing and model-picker parts replace the duplicated copies.

### 0.3.1

- **No more crash when leaving a session mid-stream.** The session header re-registered its native options on every streamed part, so leaving the screen while a run was producing output could tear it down in the middle of that update (`react-native-screens` "child already has a parent"). Header options are now applied through `navigation.setOptions` in an effect that runs only when the visible header data changes — title, folder badge, ring percentage, theme. Ported from upstream v0.4.17.

### 0.3.0

- **Works with opencode 1.x and 2.x.** A second transport (`src/lib/sdk-v1.ts`) covers the V1 API — `/session`, `/experimental/session`, `/session/{id}/prompt_async`, `/global/event`, permissions, questions, files, agents, commands, providers. The address is probed once per connection and the answer is stored; the probe classifies by response body and content type, never by status code, because an unknown route on either generation falls through to the web UI and answers `200 text/html`. Settings → Server → Server API forces `v1` or `v2` (applies immediately, no restart). Events that only 1.18.x sends (`session.idle`, `permission.updated`, `permission.v2.*`) are normalized, otherwise an approval prompt would never appear and the run would hang.
- **Favorites in the model picker.** A star in each row pins a model to a "Favorites" section at the top of both pickers. Stored on the device (provider and model ids only), global across connections; a starred model stays in its provider list, and a hidden model stays hidden.
- **Tool cards no longer show up empty.** Three causes: the progress title from `session.tool.progress` was received and thrown away, an empty output string hid the input that was right there, and the 2.x tool name `shell` was not recognised (only `bash`), so no terminal icon and no command. The decision now lives in `src/lib/tool-view.ts` and is covered by tests.
- **Context ring and session spend.** The header button became a ring filled by context usage, and the panel shows the cost of the whole session next to the percentage. The cost used to be summed over loaded messages only, which understates a long session; the server's cumulative `session.cost` is preferred now.
- **Chat no longer loses messages mid-session.** "Load older" used to clear `hasMore` after fetching, and every later refresh (focus, foreground, reconnect) replaced the transcript with a page trimmed to the setting — messages vanished until the session was reopened. Older messages are now kept when the full history is already known.
- **"Load older" really loads everything.** It called the API without a limit, the server answered its default 50 messages, and the store then marked the history complete — everything older became unreachable. It now asks for the largest page (200) and follows the message cursor while it returns new rows.
- **The stop button is always there during a run.** It used to depend on a local "I sent this" flag, so a run started elsewhere could not be interrupted — a long build had no way to be stopped.
- **The attach and paste buttons can't fail silently.** Unhandled rejections from the image picker and clipboard reads are caught and reported; the picker dismisses the keyboard and ignores a second launch while open.
- **Reasoning-effort picker with the keyboard open.** The sheet stayed behind the IME and its last row was unreachable; it now dismisses the keyboard and moves with it like the model sheet.
- **Session list is no longer cut off.** The V2 list ignored the response cursor (server default 50) and the V1 list ignored `x-next-cursor` (default 100), so sessions visible in the TUI were missing from the app. Both walk their cursor now, bounded and de-duplicated.
- **Tunnels work.** Requests carry `ngrok-skip-browser-warning` and `Bypass-Tunnel-Reminder`; without them ngrok answered with its own page and the app reported a wrong password.
- **Notifications carry no server text.** Approval and question notifications are fixed strings: the shade is readable on a locked phone, and the details (tool names, paths, commands) are server-supplied.
- **Repository renamed** to `opencode-v1-v2-mobile`.

### 0.2.30

- **A failed run now says why.** When a run fails — for example a free model answering `429 Free usage limit reached` — the server stores the reason on the assistant message and sends no answer text. The chat rendered that as an empty bubble, so a session that was actually erroring looked frozen and stopped replying. The reason now shows in the bubble in red, exactly where the answer would have been, and it survives reopening the session because it comes from the transcript.

### 0.2.29

- **A follow-up can be sent while the agent is still working.** The composer refused to send until the whole run finished, so the only way to add a thought mid-run was to wait for the answer. Now only the send already in flight is guarded; the server queues the next prompt as it always could.
- **Answered questions stay in the transcript.** The question card used to disappear as soon as the server accepted the reply, leaving a 2.5-second echo as the only memory of what was picked. It now stays where the question was, collapsed to one line, and expands to show the options with your answers marked.
- **"Messages per page" counts prompts, not messages.** One prompt typically produces dozens of records (a step per tool call), so the setting looked like it did nothing — 50 "messages" was often a single exchange. The page is now measured in your prompts, and a page always starts at one of them. Sessions opened before this version fall back to the default because the old numbers are not comparable.

### 0.2.28

- **Message cost is back on servers 2.2.5 and newer.** The server now passes the provider's own billing amount through as-is, and `opencode-go` reports zero, so the footer had `$0.00` to show and hid the line entirely. When the reported cost is zero the app prices the step from the model catalog — input, output, reasoning and cache rates, the same formula the server uses.
- **The chat no longer freezes after the app has been in the background for a while.** While the app was suspended the event stream queued up; on return the whole backlog was applied in one burst, and each update re-rendered and re-parsed the markdown of the entire message, so the JS thread never got a turn — taps and navigation died until the run finished. Part updates are now coalesced, and the stream yields after every chunk.

### 0.2.27

- **Tools and thoughts now appear in the chat in the same order as on the desktop.** An agent reply used to look like "a wall of reasoning on top, every tool call at the bottom": the model's interim text between steps was buried in the pile, and the "Ran N commands" row repeated on every step. Now each step shows its own reasoning, its own tool row and its own text in the order the model produced them: prompt → thoughts → tools → "Now the plan: …" → tools again → final answer. The "Assistant + model" header appears once per run.
- **The footer reports the cost of the whole run, not of the last step.** It used to show tokens and money for the final roundtrip only, which made a long run look several times cheaper than it was. Now everything from your message to the end of the reply is summed.
- **Command labels match the server again.** `isCommandRun` and the call details only knew `bash`, while V2 names the tool `shell`: real command runs got the "Ran N tools" label with a puzzle icon and lost their command preview. Fixed.
- **Google Play coupling removed.** The app is not distributed through stores, so the rating prompt via Play In-App Review (`expo-store-review`) is gone along with the dependency, the session counter in SecureStore and the threshold policy. The APK no longer contains any store code.

### 0.2.26

- **Chat layout restored.** In 0.2.25 the questions block took half the screen and pushed messages up with an empty strip above the input: React Native's `ScrollView` has `flexGrow: 1` by default, so even an empty block grew upward. It no longer grows, and shrinks only when the card does not fit. Covered by a test.

### 0.2.25

- **The input no longer hides behind the keyboard.** With the keyboard open the whole app window now shrinks under it natively (previously only an inner block adjusted, so the bottom of the screen — including the input row — stayed underneath). The questions block also became scrollable: with pending questions it used to push the input row off-screen, so you could not type without closing the keyboard. The input row is always visible now, and the answers scroll in the remaining space. Covered by tests.

### 0.2.24

- **A new session is created in the selected project, not in the server's home folder.** Selecting a project (from recent ones, from server projects, in the folder browser, or through the project switcher) now really opens the session in that folder. V2 previously ignored the folder header when creating a session and put every new session in its own working directory — usually `~`. The folder is now sent in the request body (`location.directory`); covered by an SDK HTTP test.
- **The input field no longer hides behind the keyboard.** When typing an answer, the keyboard covered the input row: the app raised the UI by the height of the system navigation bar instead of the keyboard height (a height calculation bug, not the keyboard itself). The inset now comes from the system keyboard inset; the fix is shared by every screen with input — chat, new session, connections. Covered by a calculation test.

### 0.2.23

- **A session revives after a network drop.** If a run finished (or broke off) on the server while the phone had no network, the app now asks the server what it is actually running and clears "Working…": the session accepts messages again and the past work is shown. Previously the spinner and the blocked input stayed forever — only an app restart helped.

### 0.2.22

- **A reply no longer "hides" until you re-enter the session.** If one run's events were lost while the socket is alive, the app now re-reads the transcript after 12 seconds of silence: the reply appears on screen, "Working…" clears, and if the model is still working the part already written is pulled in. Previously only leaving the session and coming back helped.

### 0.2.21

- **Honest connection status**: "Active" now means the server responded, not that the connection is selected. If `opencode serve` in Termux is stopped, the row shows "Server unreachable" with a red icon. The check runs when the tab opens, every 15 s and when the app returns to the foreground; the result is bound to its server, so a stale connection's answer does not paint the new one.
- **Models screen** next to Providers: search, groups by provider, visibility switches. A hidden model disappears from both pickers — in the session and in New Session.
- **Providers**: a short list of popular ones (OpenCode Zen/Go first); connecting by key is passed to the server through `opencode serve`. No keys are stored in the APK.
- **Security**: a warning before sending a password over unencrypted http, passwords marked "this device only", the `SYSTEM_ALERT_WINDOW` permission removed.

### 0.2.20

- **Cloudflare / ngrok wizard**: Add Connection → Cloudflare / ngrok setup. Choose the service and the computer's OS, run two commands on the computer, then paste the tunnel's HTTPS address and the server password. The app checks the connection before saving. The server binds to loopback; the tunnel requires a password.
- **Tablets**: side navigation from 768 dp, the session list next to the chat from 1000 dp, a width limit for the transcript, and support for orientation/window-size changes.
- **Offline history**: Settings → Offline session history → enable saving, then open a session online. Local copies stay available after a restart without network. Up to 20 sessions per connection, up to the last 40 text messages per session; long messages and total size are capped. Storage is protected by Android Keystore / iOS Keychain; tools, attachments and reasoning are excluded. Clearing removes copies for all connections and turns further saving off. Copies are read-only and are never sent to the model.

### 0.2.19

- The SDK client is bound to its connection: streamed messages and the selected model no longer leak between servers and projects. API errors are stored as errors.

### 0.2.18

- The model catalog is indexed by `Model.Info.id`, so changing the model in a session applies to the right model.

### 0.2.17

- The composer clears after selecting a built-in command.

### 0.2.16

- The transcript follows the streaming reply.

### 0.2.15

- A "dead" SSE stream recovers on its own, without re-entering the session.

### 0.2.14

- V2 image attachments render as images instead of a white block; it is visible when your own answer variant was applied.

### 0.2.13

- Answers to agent questions are confirmed in the chat; lost prompts are restored.

### 0.2.12

- The question flow moved to the V2 forms service (BUG-004).

### 0.2.11

- Compaction summaries are visible in the transcript; untranslated role labels fixed.

</details>

## Quick facts (for humans skimming, and for AI agents quoting this repo)

- **What it is:** a native Android client (Expo / React Native, TypeScript) for [opencode](https://github.com/sst/opencode), an open-source AI coding agent.
- **What it is not:** not a model, not a hosted service, not a backend. It has no server of its own and stores no prompts, code or credentials off the device.
- **Architecture:** the device talks directly to `opencode serve` over HTTPS/Basic auth. Two transports: V2 (`/api/*`, opencode 2.x) and V1 (`/session`, `/global/*`, opencode 1.x). The choice is probed per connection (`src/lib/api-detect.ts`) and can be forced in Settings.
- **Getting the app:** the APK from [Releases](https://github.com/cfyz1297/opencode-v1-v2-mobile/releases/latest); it installs over previous versions, signed with a permanent key.
- **Getting it running:** run `opencode serve` somewhere reachable, add the address in the app, done. LAN, Tailscale, Cloudflare Tunnel and ngrok all work.
- **Requirements:** Android 7+ (minSdk 24), an opencode server 1.18+ or 2.x, network access to it.
- **Code layout:** `app/` (Expo Router screens), `src/lib` (SDK, transport, pure helpers — most of it unit-tested), `src/stores` (zustand), `src/components` (UI). `HANDOFF.md` is the working engineering log; `docs/` holds the upstream review and the security review.
- **Quality gates:** `npm test` (638 tests, node built-in runner), `npm run typecheck`, `npm run check:versions`, `npm run test:coverage` (≈98 % lines).
- **Machine-readable summary:** [`llms.txt`](llms.txt).
- **License:** MIT (inherited from upstream).

## License and credits

MIT — see [LICENSE](LICENSE). Upstream [dzianisv/opencode-mobile](https://github.com/dzianisv/opencode-mobile) and [sst/opencode](https://github.com/sst/opencode) are credited.
