# Changelog

Every release, newest first, with the reason behind the change. Patch and minor
entries from before 0.3.23 were moved here from the README unchanged.

### 0.3.24

- **Attach any file, not only a photo.** The attach button opened the gallery on every tap, so a `.txt`, `.json`, `.pdf` or archive could not be sent at all — the native OpenCode client accepts anything. Tapping it now raises a menu with three sources: camera, photo from the gallery (still compressed to JPEG) and any file from the system picker. A document's bytes are read as base64 and travel in the prompt, because the server cannot read the phone's filesystem; verified against a live server: a `text/plain` attachment arrives and the model sees "Attached file: *name*" plus its content. Limits for picked files are 10 MB per file and 20 MB per batch, counted across picks — the base64 sits in app state until the send and again in the request body. Photos go through the gallery path, which compresses them and does not count towards that batch. A non-image shows as a document tile in the composer and as a chip in the transcript: the transcript used to render only `image/*` file parts, which would have hidden every sent document.
- **Links in chat open.** A markdown link, a bare URL, a URL in backticks and a URL in your own message were all inert on Android: the library's link was a *selectable* text inside the transcript row, so the tap never fired, and your messages had no markdown pass to begin with. All four surfaces now open, with Copy offered when nothing can handle the URL. Only `http`, `https`, `mailto` and `tel` are dispatched. A markdown href is written by the model, so without a scheme allowlist an injected message could one-tap anything that claims a scheme — a payment or banking deep link, `intent:`, `content:` or a custom app scheme. The `tel:` link is allowed on purpose (it opens the dialer with a number, never calls); the `[![alt](img)](href)` form is covered too, because the parser hands it to a different renderer method that used to call the OS opener directly.
- **The attach menu is a sheet, not a system dialog.** One icon per source, in the app's own style and colours, with Back closing it and the keyboard dismissed first — an `Alert` cannot carry icons, and it opened behind the IME.
- **A non-ASCII password no longer hangs the connection screen.** The diagnostic probe built its Basic auth header with a raw `btoa`, which throws on any character outside Latin-1; the throw landed in the failure path before the spinner was cleared, so the user saw "connecting" forever and no report. It now uses the same UTF-8-safe helper as every other request.
- **The diagnostic report no longer publishes a server password.** A URL typed with embedded credentials could reach the pasted report — through the URL line, the parsed host, the probe targets and the log buffer, in several shapes (`@` in the password, a mixed-case scheme, a space, `?` or `#`). The parser now drops the whole userinfo before any field is built, every printed URL is scrubbed directly instead of relying on the whitespace-splitting pass, and picked file names and app-cache paths are kept out of the shared log.

### 0.3.23

- **The work clock moves while the model thinks.** The status bar showed a static label, so a long reasoning turn looked stalled. It now counts from the first busy event of the run, and a tool's clock starts at its first event rather than at the "running" status: a call still streaming its input already ticks and shows a spinner. A run recovered after a lost idle event no longer leaks its clock into the next run.
- **A finished subagent flips to Done by itself.** The child row is fetched when the screen opens and carries no idle stamp, and V2 sends no `session.updated` to refresh it; the live idle event was read as "not busy" and fell back to the missing stamps, so a completed subagent sat on "Waiting" until the screen was re-entered.
- **Parallel delegations are all listed.** The subagent bar deduplicated by child session id across the whole transcript, so a call that resumed a session spawned earlier was dropped and the old row stayed in its place — "Now" showed one subagent out of two. Deduplication now applies within a turn.
- **Questions survive a crash.** A restart wiped every busy flag, so nothing polled a session the server was still blocked on. The app now adopts the server's active-session list on connect, which restarts prompt polling; a question whose message is not among the rendered rows falls back above the composer instead of disappearing.
- **An answered question stays where it was asked.** The transcript merged every assistant step into one run row, so a question card drawn under that row sank to the bottom of the whole turn. A run now ends at the message that asked, keeping one header and one token footer.
- **Finished subagents are listed newest first**, with running ones always on top.
- **The release check covers the lockfile**, and the dead iOS config is gone from `app.json`.


### 0.3.22

- **The transcript stays with the answer while it streams.** The list was inverted, which in React Native grows the newest row *upward*: every existing row shifted on every token, and the text crawled out from under the reader. Four compensations were tried on a device — per-cell height deltas, the newest cell's height, the content's total height, and React Native's own `maintainVisibleContentPosition` — and none of them survived a real streaming answer. The list is now a plain one: growth happens at the bottom and cannot move text above it. History still loads when you reach the top, with the spinner as the header, and `maintainVisibleContentPosition` is kept only for that one case, a page inserted above the reader.
- **Following the answer does not switch itself off.** Auto-follow used to be recalculated from every scroll sample. Those samples are throttled to 100 ms while a streaming delta grows the content continuously, so the sample carried the offset from *before* the growth, its distance from the end looked like the reader had scrolled away, and following stayed off for the rest of the session. Following now belongs to gestures: a drag takes it away, the end of a drag or a fling that lands at the bottom gives it back. A scroll sample never changes it.
- **The last line is no longer left behind.** `scrollToEnd` aims at the last row's *measured* frame, and that frame always trails the chunk that just arrived — the list stopped a line short and the rest had to be dragged. On Android the scroll now aims past the end and the native `ScrollView` clips it to the real content bottom, so no JavaScript measurement takes part.
- **A finger lift no longer fights the fling,** and another resize no longer pushes the text out of view. Releasing a finger with velocity still leaves momentum ahead, so follow is re-armed at the end of the fling, not at the lift. The composer, the "Working…" row, banners and the keyboard all change the list height during a run; while following, the list lands on the end again after a real size change, instead of leaving the newest line below the fold or empty space under the text.
- **A reloaded transcript opens at the newest message.** Coming back from a subagent session re-mounted the list at offset 0, which in a plain list is the *oldest* row, and the mounting offset read as "the reader scrolled away" — the conversation opened at its beginning. A reload now counts as a fresh open: hidden until it reaches the end.
- **Selecting text no longer scrolls the transcript.** A long-press on a message used to move the list; text selection now owns the gesture and the list stays where it is.
- **The message navigator follows the plain list.** The counter counts from the oldest, a jump aligns its message to the top, and a transcript whose rows are not laid out yet starts at the newest message instead of index 0 — which after the flip is the oldest.

### 0.3.21

- **The transcript no longer loses history when the app comes back.** A foreground refresh and the reconnect resync asked the server for its default page — 50 messages — and replaced everything on screen with it. Older exchanges, and the subagent cards derived from them, vanished until the session was reopened; a long transcript also looked cut in half. The refresh now asks for the configured page (or the whole session), keeps the history already loaded, and a late answer can no longer land in a session you just switched to. Child sessions are re-read on resume, so a subagent that finished while the app was backgrounded stops reading "Idle".
- **Activity is one line per answer.** Every reasoning block and every tool card was printed in sequence, so a long run pushed the answer off the screen. Everything between two answers now folds into one spoiler row — `5 · Shell, Read · 12.3s` — that counts the whole segment instead of repeating "1 step" per message, names the tools from the catalog, sums their time (counting up while one runs) and turns into an error mark on failure. Opening it shows the previous design unchanged. Consecutive assistant steps are a single transcript row, so headers, copy buttons and token totals appear once. A subagent delegation is deliberately left outside: folding it would hide the only way into the child session.
- **A navigator for long transcripts.** The floating "latest" button could cover a line of text. It is now a compact pill row above the composer — counter, one message up, one down, double-chevron to the end — that appears while you scroll and fades 3.5 s after the motion stops. It walks **your own messages**, because a question never streams, merges or changes height while an answer does; the position comes from the laid-out rows, so it is correct the moment a session opens and the first tap works without a preliminary swipe. Jumps are instant rather than animated, which read as a freeze on a long transcript.
- **Errors are visible.** `useSessions.error` was written in fifteen places and rendered nowhere: a failed load or send looked like an empty, frozen session. A banner now shows the server's text, what to do next, and Copy / Dismiss. The reconnect banner adds the last disconnect reason, also copyable.
- **Markdown images no longer crash the screen.** `react-native-marked` 8.0.0 fetches an image's size in an effect with no dependency array, and its callbacks set fresh state, so any `![](url)` re-rendered until React's update-depth guard killed the session. The app now renders images through its own component with the fetch scoped to the URI (SVG keeps the library's, whose effect is scoped). React keys also no longer come from `github-slugger`, which stored a property per call on a long-lived renderer and could hit Hermes' 196,607-property limit inside one huge message.
- **Tool durations survive a reopen.** The server sends a tool part's own clock (`created`, `ran`, `completed`); the history mapper dropped it, so a reopened session had no durations and the folded run could not show its total. Both transports share one bounded SSE handshake too — the V1 stream used to dial without a deadline and could hang forever after reporting "connected".

### 0.3.20

- **The last line of a message is no longer cut in half.** React Native implements `lineHeight` with spans, and `CustomLineHeightSpan` pins the bottom of a block's last line to the font's reported descent. A font whose glyphs reach below that descent — a themed system font on a real phone, unlike the emulator's Roboto — had the bottom of every paragraph's final line clipped, while inner lines only overlapped and looked fine. That is why the cut always landed on the last line, looked identical on every build, and never reproduced on the emulator at any density. `lineHeight` is no longer set, so Android derives the line box from the real font metrics.
- **Code in an expanded tool card scrolls sideways.** The whole card was one `TouchableOpacity`: a tap or drag on a diff bubbled up as a press and collapsed the card, so the code did not "refuse to scroll", it disappeared under the finger. Only the header is pressable now, and the horizontal `ScrollView` sets `nestedScrollEnabled`, because the transcript is a vertical `FlatList` and Android hands a nested scroller the gesture only on a perfectly horizontal drag.
- **Subagents are visible and can be opened.** A delegation used to leave no trace: the tool returns at dispatch time, so the parent looked idle while a child worked. The card that launched it now draws a row with the task, the agent, a live status pill (Running / Done / Failed / Idle) and a tap into the child transcript, in the parent's workspace. Two counters under the header show the current batch and the session total; running children come first. Child sessions stay out of the Recent list, and their status comes from the live run state or the child's `idle` stamp, so a subagent that finished before the app connected still reads Done.
- **A question card is drawn where the question was asked** — under the message whose form asked it, and the transcript jumps to it — instead of above the composer, outside the transcript, where anyone scrolled up never saw it and the run looked hung.
- **No more dark screen after a long background run.** `HeadlessJsTaskService` returns `START_REDELIVER_INTENT`, so Android restarted the keep-alive service after a process death and booted a *headless* React instance; the next launch then attached the Activity to a host started without one, the splash never hid and the app closed. It now returns `START_NOT_STICKY`. Separately, Android 15 caps `dataSync` foreground services at six hours per 24 and kills the app when the budget runs out — the service uses `specialUse` on API 34+ and stops itself on timeout.
- **Smaller fixes from upstream:** a camera launch that throws no longer leaves the button dead, `aborted` from speech recognition is no longer reported as an error, and the event stream gives up after 15 s if the server never answers headers instead of showing "Connected" over a dead socket.

### 0.3.17

- **Background notifications.** React Native pauses its own JS timers when the app leaves the foreground, so nothing generated notifications. `KeepAliveService` is a headless task for the whole run and the watch polls the server instead of local state: completion, questions and permission requests reach a locked phone.
- **Notification icons** per category (question, error, completed, permission) from a small native module, because Android draws a small icon as a monochrome mask and expo-notifications falls back to a white square.
- **Answered questions stay under the message that asked them**; the "Session running" card is gone; the model picker dismisses the keyboard before opening; notifications fire only while the app is backgrounded, one per run, deduplicated.

### 0.3.7

- **Voice input works for the first time.** `expo-image-picker` was configured with `microphonePermission: false`, and that plugin turns the value into a *blocked* permission: expo wrote `<uses-permission android:name="android.permission.RECORD_AUDIO" tools:node="remove"/>`, so `RECORD_AUDIO` never reached the assembled manifest and the permission request could only answer "denied". Confirmed with `aapt dump permissions` on the previous release — no `RECORD_AUDIO` at all. The option was added in the same commit as voice input, so the feature never worked. CI now fails the build if the release APK lacks the permission.
- **Model and effort pickers open again.** `@gorhom/bottom-sheet` 5.2.8 measured the window incorrectly under RN 0.88 / edge-to-edge, so the sheet mounted off-screen: the chip tap landed and nothing appeared. Bumped to 5.2.14.
- **Expo SDK 58, React Native 0.88.1, React 19.3.0.** This is what fixes the "unregistered ActivityResultLauncher" crash for good: from `expo-modules-core` 58 the registry re-registers a launcher on the next use instead of throwing after Android destroys the Activity. SDK 58 also regenerates `android/` on every prebuild, so the release signing, `dependenciesInfo`, `usesCleartextTraffic` and the IME reporter moved into `plugins/with-native-customizations.js`.
- **The CUA smoke now exercises both pickers**, picking a model and a reasoning effort and checking the chip label follows, and dumps logcat on failure.

### 0.3.6

- **Attaching a photo no longer fails silently at the tap.** Tapping `+` dismissed the keyboard and then showed "image not attached" with no picker on screen: the system photo-picker activity rejected the launch before any choice was made. The app now retries once with the legacy `ACTION_GET_CONTENT` intent, which the device's file manager always answers.
- **A failure names its reason.** Both the picker rejection and a failed conversion to JPEG used to show the same generic alert, so the report could not tell them apart. The technical reason is now written to the log buffer (it travels with diagnostics reports) and shown inside the alert.

### 0.3.5

- **A long-running tool no longer looks like a frozen app.** The row showed a duration only when both the start and end timestamps were present, and a running tool has no end — so a ten-minute command sat there with no sign of life. It now ticks the elapsed time every second and reads `5m 05s` past the first minute. V2 servers also send no timing for tool parts at all (checked against a live server: `{status, input, content, metadata}` and nothing else), so the V2 adapter now builds that window from the event timestamps instead of assuming it exists.

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
