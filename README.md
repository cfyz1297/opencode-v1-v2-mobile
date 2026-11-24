# OpenCode V1/V2 Mobile (cfyz1297 fork)

**English** | [Русский](README.ru.md)

> **Android client for the OpenCode AI coding agent.** Drive your `opencode serve` sessions from a phone: live transcript, tool approvals, diffs, model and reasoning-effort switching — over LAN, Tailscale or a tunnel. Works with **opencode 1.x (V1 API) and 2.x (V2 API), auto-detected.**

A fork of [dzianisv/opencode-mobile](https://github.com/dzianisv/opencode-mobile), built with Expo/React Native. Distributed as an APK from GitHub Releases only — no app stores, no account, no backend of its own: the app talks straight to your server.

Version **0.3.25 (90)**, installs over 0.3.24. Every build runs 949 automated tests plus an Android CUA smoke on an emulator.

| You want… | This repo |
|---|---|
| An Android client for **opencode 2.x** (`/api/*`) or **1.x** (`npm i -g opencode-ai`), one APK | yes, auto-detected with a manual override |
| A client for a server in **Termux** on the same phone, on a laptop or a VPS | yes — see [opencode-termux](#android-the-server-in-termux) below |
| Approvals, diffs, stop, subagents, questions — from the phone | yes |
| No telemetry, no account, no Play Store | yes — APK from Releases only |
| An iOS build | no — the iOS config was removed |

## Install

- **[Download opencode-mobile-v2.apk](https://github.com/cfyz1297/opencode-v1-v2-mobile/releases/latest/download/opencode-mobile-v2.apk)** (≈100 MB)
- All releases: [Releases](https://github.com/cfyz1297/opencode-v1-v2-mobile/releases). The file name stays `opencode-mobile-v2.apk`: the update check and the CI signature comparison depend on it.

Since `0.2.9` the APK is signed with a permanent key. If you are on an older build, uninstall it **once**; after that updates install in place.

## Connecting to an opencode server

The app speaks both server generations: it probes the address once, remembers the answer per connection, and uses the matching transport — `/global/health` + `/global/event` for V1, `/api/info` + `/api/event` for V2. The probe classifies by response body, never by status code: an unknown route on either generation falls through to the web UI and answers `200 text/html`. **Settings → Server → Server API** forces `v1` or `v2` if auto-detection ever picks wrong.

### Desktop or VPS (V2)

```bash
curl -fsSL https://opencode.ai/v2/install | bash
OPENCODE_SERVER_PASSWORD=yourpassword opencode serve --hostname 0.0.0.0 --port 4096
```

Then in the app: **Add Connection** → `http://IP:4096`, user `opencode`, the password above.

### Android: the server in Termux

The server for Android is [**opencode-termux**](https://github.com/cfyz1297/opencode-termux): OpenCode 2 compiled for Bionic, so it runs inside Termux with no glibc, no proot and no compatibility layer. The app's intended setup is exactly this — server and client on the same phone, reached over `127.0.0.1`, which is why cleartext to loopback is allowed and a foreground service keeps notifications alive.

```bash
curl -fsSL https://raw.githubusercontent.com/cfyz1297/opencode-termux/main/install.sh | bash
OPENCODE_SERVER_PASSWORD=yourpassword opencode serve --hostname 0.0.0.0 --port 4096
```

`opencode upgrade` (or re-running the install command) updates it. Builds from `2.2.5-r1` include the TUI crash fix for Android 17; the server API is the same as the official V2 binary.

### V1 servers

An opencode 1.x server (`npm install -g opencode-ai`) needs no extra setup: the same APK detects it and uses `/session`, `/session/{id}/prompt_async` and `/global/event`. Servers older than 1.18.x are not supported.

## What the app does

- **Chat:** live text, reasoning, tools and diffs in the order the model produced them; follow-up messages while a run is working; stop follows the server's real run status, so a run started elsewhere can still be interrupted; edit/revert; compaction summaries; image attachments.
- **Activity folded per answer:** everything between two answers collapses into one row — `5 · Shell, Read · 12.3s` — with a live timer, a spinner while it works and an error mark on failure. A subagent delegation is never folded.
- **Subagents:** a row inside the tool card that launched it, with a live status pill and a tap into the child transcript; two counters under the header (current batch / session total); running first, finished newest first; child sessions stay out of the Recent list.
- **Questions and approvals:** inline cards placed where the question was asked, collapsed to one line after the answer. A question that arrives while the app is closed is picked up on reconnect, because the app adopts the server's active-session list.
- **Long transcripts:** a navigator over the composer that counts your own messages and steps one at a time; history page measured in prompts (5/10/25/50/All); a foreground refresh keeps what is already loaded.
- **Session info:** context ring in the header, tokens, context bar and whole-session spend.
- **Models and agents:** searchable picker grouped by provider, favourites, hidden models, reasoning effort where the model exposes it.
- **Connections:** several servers, passwords in Keystore/Keychain, honest "Active" (server answered, polled on focus and every 15 s), tunnel wizard for Cloudflare named tunnels and ngrok, providers screen, diagnostics report.
- **Reliability and privacy:** stream watchdog and transcript re-read after silence, offline encrypted read-only history, biometric unlock, notifications with fixed text, tablet layout, native keyboard inset, no telemetry.

## How the fork differs from upstream

The base is [dzianisv/opencode-mobile](https://github.com/dzianisv/opencode-mobile) at `v0.4.15`; the 1.x transport and the header fix from `v0.4.16`/`v0.4.17` were ported by hand. From `v0.4.15` the fork runs its own version line.

| What | Upstream | This fork |
|---|---|---|
| Server API | 1.x only | **both** 1.x and 2.x, auto-detected |
| Delivery | Play, F-Droid, APK, EAS, iOS | APK from GitHub Releases only |
| Telemetry | Sentry + PostHog | removed |
| Orientation / layout | portrait only | any; tablet layout from 768 dp |
| Offline history | none | encrypted read-only copy |
| Tunnels | connection form only | Cloudflare and ngrok wizard |
| Run recovery | none | silence watchdog, transcript re-read, active-session resync |
| Subagents | read-only section above the transcript | a row in the launching card, opens the child session; live status |
| Long transcripts | floating controls over text | pill navigator over the composer |
| Tests | `node --test` over a glob | runner + coverage gate + CUA smoke on an emulator |

The main code pieces: `src/lib/v2-compat.ts` normalizes V2 responses and events to the V1 shape (so stores and screens are shared), `src/lib/sdk-v1.ts` is the V1 transport with `src/lib/api-detect.ts` choosing between them, `src/lib/subagent-status.ts` derives subagent rows, `src/lib/tool-view.ts` renders tool cards, `src/lib/session-stats.ts` computes tokens/context/cost for the ring and the panel.

Not present: provider OAuth (API key only), OpenCode Cloud, iOS builds, store publishing, telemetry.

## Security

- Passwords and offline history live in the Android Keystore / iOS Keychain with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: they are not in OS backups and are not restored on another device.
- Plain `http://` encrypts neither the password nor the transcript; the connection forms warn about it. Loopback (Termux on the same phone) shows no warning — traffic never leaves the device.
- The app does not request `SYSTEM_ALERT_WINDOW`, and approval/question notifications carry fixed text — no server-supplied tool names, paths or question bodies on the lock screen.
- No telemetry. Build-time dependencies (Metro/Babel/Expo CLI) report `npm audit` entries; none of that code ships in the APK.

## Building and testing

```bash
git clone https://github.com/cfyz1297/opencode-v1-v2-mobile
cd opencode-v1-v2-mobile
npm install
npm run android          # dev build
```

The release APK is built by GitHub Actions on every push to `main` and on `v*` tags: versions, typecheck and tests first, then `expo prebuild` + `gradlew assembleRelease`, then the CUA smoke on an Android emulator. Gates: `npm test`, `npm run typecheck`, `npm run test:coverage` (80 % floor), `npm run check:versions` (also checks the lockfile).

## Links

- [CHANGELOG.md](CHANGELOG.md) — every release, why it happened
- [HANDOFF.md](HANDOFF.md) — engineering log and current state
- [docs/](docs/) — security reviews and design notes
- [llms.txt](llms.txt) — machine-readable summary

## License

MIT — see [LICENSE](LICENSE). Credits: [dzianisv/opencode-mobile](https://github.com/dzianisv/opencode-mobile) (upstream) and [sst/opencode](https://github.com/sst/opencode) (the agent).
