// Deterministic Android computer-use smoke: real release APK, UIAutomator
// snapshots, touches and screenshots. No paid model or cloud credentials.
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const pkg = 'cc.agentlabs.opencode'
const out = 'artifacts/roadmap'
mkdirSync(out, { recursive: true })
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 30000 })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function snapshot() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/window.xml')
  return adb('shell', 'cat', '/sdcard/window.xml')
}
// Navigator counter as "N / M": read the node text when Android exposes the
// testID as resource-id, fall back to the accessibility label otherwise.
function counterValue(xml) {
  const node = (xml.match(/<node\b[^>]*>/g) ?? []).find(n => n.includes('resource-id="nav-counter"'))
  const text = node?.match(/text="([^"]*)"/)?.[1]
  if (text) return text
  const label = xml.match(/content-desc="Message (\d+) of (\d+)"/)
  return label ? `${label[1]} / ${label[2]}` : undefined
}
function tapBounds(xml, predicate) {
  const node = xml.match(/<node\b[^>]*>/g)?.find(predicate)
  if (!node) return false
  const [, x1, y1, x2, y2] = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) ?? []
  if (!x1) return false
  adb('shell', 'input', 'tap', String(Math.floor((+x1 + +x2) / 2)), String(Math.floor((+y1 + +y2) / 2)))
  return true
}
async function dismissVoiceAlert() {
  const xml = snapshot()
  // Alert dialogs steal the UIAutomator hierarchy — dismiss before asserting chat text.
  if (!(xml.includes('Voice input failed') || xml.includes('Microphone permission'))) return false
  if (tapBounds(xml, n => n.includes('text="OK"'))) await sleep(400)
  return true
}
async function waitFor(value, timeout = 45000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    // Only auto-dismiss voice alerts here. Broad sheet-tapping in waitFor
    // raced the tunnel wizard and could leave the app (launcher screenshot).
    if (await dismissVoiceAlert()) continue
    const xml = snapshot()
    if (xml.includes(value)) return xml
    await sleep(500)
  }
  writeFileSync(`${out}/failure.xml`, snapshot())
  throw new Error(`UI did not contain ${value}`)
}
async function tap(value, scroll = false) {
  if (scroll) {
    for (let i = 0; i < 5 && !snapshot().includes(`="${value}"`); i++) {
      const dimensions = adb('shell', 'wm', 'size')
      const [, width, height] = dimensions.match(/Override size: (\d+)x(\d+)/) ?? dimensions.match(/Physical size: (\d+)x(\d+)/) ?? []
      assert.ok(width && height)
      adb('shell', 'input', 'swipe', String(Math.floor(+width / 2)), String(Math.floor(+height * 0.8)), String(Math.floor(+width / 2)), String(Math.floor(+height * 0.3)), '350')
      await sleep(400)
    }
  }
  const xml = await waitFor(value)
  const nodes = xml.match(/<node\b[^>]*>/g) ?? []
  // Prefer testID/resource-id; Android Alert destructive actions often upper-case the label.
  const node = nodes.find(n => n.includes(`="${value}"`))
    ?? nodes.find(n => n.includes('clickable="true"') && new RegExp(`text="${value}"`, 'i').test(n))
  assert.ok(node, `Exact visible node ${value}`)
  const [, x1, y1, x2, y2] = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) ?? []
  assert.ok(x1, `Bounds of ${value}`)
  adb('shell', 'input', 'tap', String(Math.floor((+x1 + +x2) / 2)), String(Math.floor((+y1 + +y2) / 2)))
  await sleep(400)
}
async function type(value, text) {
  await tap(value)
  adb('shell', 'input', 'text', text)
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
}
async function open(path) {
  adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `opencode://${path}`, pkg)
  await sleep(1000)
}
async function dismissBlockingSheets() {
  for (let i = 0; i < 3 && (snapshot().includes('Select Model') || snapshot().includes('Search models')); i++) {
    // Tap the upper chat/backdrop area — Back alone can leave the session stack.
    const dimensions = adb('shell', 'wm', 'size')
    const [, width, height] = dimensions.match(/Override size: (\d+)x(\d+)/) ?? dimensions.match(/Physical size: (\d+)x(\d+)/) ?? []
    assert.ok(width && height)
    adb('shell', 'input', 'tap', String(Math.floor(+width * 0.75)), String(Math.floor(+height * 0.18)))
    await sleep(500)
  }
  if (snapshot().includes('Select Model') || snapshot().includes('Search models')) {
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    await sleep(400)
  }
  if (!snapshot().includes('chat-message-input')) {
    await open('session/roadmap-session')
    await waitFor('OFFLINE_ANSWER_42')
  }
}
// After a configuration change the activity can be recreated on top of the
// previous route (offline history, model sheet) and the deep link loses the
// race, so the session is never shown. Back out and reopen until the composer
// is really there.
async function ensureSessionOpen() {
  for (let i = 0; i < 3; i++) {
    if (snapshot().includes('chat-message-input')) return
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    await sleep(600)
    await open('session/roadmap-session')
    await sleep(1200)
  }
  if (!snapshot().includes('chat-message-input')) throw new Error('could not open roadmap-session')
}
function screenshot(name) {
  writeFileSync(`${out}/${name}.png`, execFileSync('adb', ['exec-out', 'screencap', '-p']))
  writeFileSync(`${out}/${name}.xml`, snapshot())
}
const now = Date.now()
const session = { id: 'roadmap-session', title: 'ROADMAP_SESSION', location: { directory: '/fixture' }, time: { created: now, updated: now } }
// Delegated child session: same workspace as the parent, finished before the
// Three delegated subagents, one per user turn, so the bar can be checked
// against the real question: which of them belong to "now"?
//   child-old   wave 1, idle stamp        -> Done, and only in "All"
//   child-busy  wave 2, busy, no idle     -> Running, and still in "Now"
//   child-new   wave 3, idle stamp        -> Done, the current batch
const childOld = { id: 'child-old', parentID: 'roadmap-session', title: 'Old task', location: { directory: '/fixture' }, time: { created: now, updated: now + 3, idle: now + 3 } }
const childBusy = { id: 'child-busy', parentID: 'roadmap-session', title: 'Busy task', location: { directory: '/fixture' }, time: { created: now + 10, updated: now + 10, busy: now + 10 } }
const childNew = { id: 'child-new', parentID: 'roadmap-session', title: 'New task', location: { directory: '/fixture' }, time: { created: now + 20, updated: now + 23, idle: now + 23 } }
const childSessions = [childOld, childBusy, childNew]
// A `subagent` tool part as the V2 server reports it: the child id travels in
// metadata, which is what lets a card or the bar link to the child session.
const delegationPart = (id, childID, description) => ({
  id, type: 'tool', name: 'subagent',
  state: {
    status: 'completed',
    input: { agent: 'general', description, prompt: `Do ${description}` },
    content: [{ type: 'text', text: 'The subagent is working in the background' }],
    metadata: { sessionID: childID, status: 'running' },
    time: { start: now + 1, end: now + 2 },
  },
})
// A tool step as the V2 server reports it — five of these across two messages
// are what the merged activity spoiler has to count as one line.
const shellPart = (id, command) => ({
  id, type: 'tool', name: 'shell',
  state: {
    status: 'completed',
    input: { command },
    content: [{ type: 'text', text: 'ok' }],
    time: { start: now + 1, end: now + 2 },
  },
})
const other = { ...session, id: 'tablet-session-two', title: 'TABLET_SESSION_TWO', location: { directory: '/other' } }
const requests = []
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  requests.push({ method: req.method, path })
  if (path === '/api/event') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(': connected\n\n')
    const timer = setInterval(() => res.write(': heartbeat\n\n'), 1000)
    req.on('close', () => clearInterval(timer))
    return
  }
  let data
  if (path === '/api/info') data = { healthy: true, version: 'fixture-v2' }
  // V2 filters children server-side; the app relies on that for subagent rows.
  else if (path === '/api/session' && new URL(req.url, 'http://localhost').searchParams.get('parentID') === 'roadmap-session') data = { data: childSessions }
  // Each child opens like any other session, with its own transcript.
  else if (/^\/api\/session\/child-(old|busy|new)$/.test(path)) data = { data: childSessions.find((c) => c.id === path.split('/').pop()) }
  else if (/^\/api\/session\/child-(old|busy|new)\/message$/.test(path)) data = { data: [{ id: 'c1', type: 'assistant', time: { created: now, completed: now }, content: [{ type: 'text', text: `CHILD_ANSWER_${path.includes('busy') ? 'BUSY' : '77'}` }] }] }
  else if (/^\/api\/session\/child-(old|busy|new)\/(form|permission|diff)$/.test(path)) data = { data: [] }
  else if (path === '/api/location') data = { directory: '/fixture', project: { directory: '/fixture' } }
  else if (path === '/api/session') data = { data: [session, other] }
  else if (path === '/api/session/tablet-session-two') data = { data: other }
  else if (path === '/api/session/tablet-session-two/message') data = { data: [{ id: 'a2', type: 'assistant', time: { created: now, completed: now }, content: [{ type: 'text', text: 'TABLET_SECOND_ANSWER_44' }] }] }
  else if (path === '/api/session/roadmap-session') data = { data: session }
  // Newest first, as the V2 endpoint returns them. Each user turn opens a wave:
  // (u1, a1) -> child-old, (u2, a2) -> child-busy, (u3, a3) -> child-new.
  else if (path === '/api/session/roadmap-session/message') data = { data: [
    // The newest turn arrives as three consecutive assistant steps (no user
    // message between them). They must render as ONE row: "Steps 1" before
    // the answer, then the delegation, then "Steps 5" for the 2+3 calls after
    // it — that total only exists if the steps were merged.
    { id: 'a5', type: 'assistant', time: { created: now + 24, completed: now + 25 }, content: [
      shellPart('p_a5_1', 'ls a'),
      shellPart('p_a5_2', 'ls b'),
      shellPart('p_a5_3', 'ls c'),
    ] },
    { id: 'a4', type: 'assistant', time: { created: now + 23, completed: now + 24 }, content: [
      shellPart('p_a4_1', 'git status'),
      shellPart('p_a4_2', 'git diff'),
    ] },
    { id: 'a3', type: 'assistant', time: { created: now + 21, completed: now + 22 }, content: [
      shellPart('p_a3_1', 'pwd'),
      { type: 'text', text: 'OFFLINE_ANSWER_42' },
      delegationPart('p_sub_new', 'child-new', 'New task'),
    ] },
    { id: 'u3', type: 'user', time: { created: now + 20 }, text: 'OFFLINE_QUESTION_43' },
    { id: 'a2', type: 'assistant', time: { created: now + 11, completed: now + 12 }, content: [
      { type: 'text', text: 'DELEGATED_SECOND' },
      delegationPart('p_sub_busy', 'child-busy', 'Busy task'),
    ] },
    { id: 'u2', type: 'user', time: { created: now + 10 }, text: 'OFFLINE_QUESTION_44' },
    { id: 'a1', type: 'assistant', time: { created: now + 1, completed: now + 2 }, content: [
      { type: 'text', text: 'DELEGATED_FIRST' },
      delegationPart('p_sub_old', 'child-old', 'Old task'),
    ] },
    // Long enough that the list really scrolls at 400x800, so the navigator
    // has something to move through.
    { id: 'u1', type: 'user', time: { created: now }, text: `OFFLINE_QUESTION_42\n${'FILLER_LINE\n'.repeat(20)}` },
  ] }
  else if (path === '/api/agent') data = { data: [{ id: 'build', name: 'Build', mode: 'primary' }] }
  else if (path === '/api/model/default') data = {}
  else if (path === '/api/model') data = { data: [
    { id: 'm1', providerID: 'fix', name: 'Fixture One', capabilities: { tools: true }, variants: [{ id: 'low' }, { id: 'high' }] },
    { id: 'm2', providerID: 'fix', name: 'Fixture Two', capabilities: { tools: true }, variants: [{ id: 'low' }, { id: 'high' }] },
  ] }
  else if (['/api/command', '/api/project', '/api/permission/request', '/api/form', '/api/session/roadmap-session/form', '/api/session/roadmap-session/permission', '/api/session/roadmap-session/diff', '/api/session/tablet-session-two/form', '/api/session/tablet-session-two/permission', '/api/session/tablet-session-two/diff'].includes(path)) data = { data: [] }
  else { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{}'); return }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
})
await new Promise(resolve => server.listen(4096, '127.0.0.1', resolve))
try {
  adb('reverse', 'tcp:4096', 'tcp:4096')
  // Keep density fixed throughout the journey: changing density recreates the
  // Android activity, whereas screenSize is handled by the application.
  adb('shell', 'wm', 'density', '160')
  adb('shell', 'wm', 'size', '400x800')
  adb('shell', 'pm', 'clear', pkg)
  await open('connection/tunnel')
  await waitFor('Step 1 of 3')
  await tap('tunnel-next', true)
  await waitFor('127.0.0.1')
  screenshot('tunnel-commands-phone')
  await tap('tunnel-next', true)
  await type('tunnel-url', 'http://untrusted.example')
  const before = requests.length
  await tap('tunnel-connect')
  await waitFor('Use a public HTTPS URL')
  assert.equal(requests.length, before, 'Invalid URL must fail before any request')
  screenshot('tunnel-reject-http')
  await tap('OK')
  await open('connection/add')
  await type('connect-ip-input', '127.0.0.1')
  await tap('connect-submit-button', true)
  // Android 13 notification prompt may overlay the session list.
  await sleep(2000)
  const prompt = snapshot()
  if (prompt.includes('com.android.permissioncontroller:id/permission_allow_button')) await tap('com.android.permissioncontroller:id/permission_allow_button')
  await open('')
  await waitFor('ROADMAP_SESSION')
  await open('history')
  await tap('history-enable')
  await open('session/roadmap-session')
  await waitFor('OFFLINE_ANSWER_42')
  await sleep(2500)
  screenshot('session-phone')
  // The delegation rows are visible without expanding the cards.
  await waitFor('New task')
  // "Now" is the latest batch plus anything still working from before:
  // child-new (wave 3) + child-busy (wave 2, still running). child-old is done
  // and belongs to an earlier batch, so it must NOT be counted here.
  await waitFor('Now: 2')
  await waitFor('All: 3')
  screenshot('subagent-bar')

  // Dark theme: the counters were white text on a light fill, i.e. invisible.
  // Night mode recreates the activity, so reopen the session before the shot.
  adb('shell', 'cmd', 'uimode', 'night', 'yes')
  await sleep(1500)
  await open('session/roadmap-session')
  await waitFor('Now: 2')
  await sleep(800)
  screenshot('subagent-bar-dark')
  adb('shell', 'cmd', 'uimode', 'night', 'no')
  await sleep(1500)
  await open('session/roadmap-session')
  await waitFor('Now: 2')
  await sleep(600)

  await tap('subagents-current')
  await sleep(700)
  await waitFor('subagent-bar-row-child-new')
  await waitFor('subagent-bar-row-child-busy')
  assert.ok(
    !snapshot().includes('subagent-bar-row-child-old'),
    'a finished subagent from an earlier batch stays out of the current list',
  )
  screenshot('subagent-bar-current')
  await tap('subagents-current')
  await sleep(400)

  // "All" is every subagent of the session, call order, running first.
  await tap('subagents-all')
  await sleep(700)
  for (const id of ['child-old', 'child-busy', 'child-new']) {
    await waitFor(`subagent-bar-row-${id}`)
  }
  screenshot('subagent-bar-open')
  await tap('subagents-all')
  await sleep(400)
  screenshot('subagent-row')

  // A child that never emitted an event still reads Running from its busy
  // stamp, and opens like any session.
  await tap('subagent-row-child-busy')
  await waitFor('CHILD_ANSWER_BUSY')
  screenshot('subagent-child-session')
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
  await sleep(800)
  await waitFor('OFFLINE_ANSWER_42')
  // The chips are the only way to change model and reasoning effort, and a
  // sheet that silently never opens is invisible to the unit tests. Tapping
  // them, and checking the label really follows the choice, is the regression
  // guard for "model and effort selection stopped working".
  // Activity spoiler: three consecutive assistant steps are ONE row — "Steps 1"
  // before the answer and "Steps 5" after it. Per-message spoilers could never
  // reach 5, and the screen used to show "Steps: 1" once per step.
  await waitFor('5 steps')
  const stepLines = (snapshot().match(/text="\d+ steps?"/g) ?? []).length
  assert.equal(stepLines, 2, 'a run shows one step line per text boundary, not one per message')
  screenshot('activity-spoiler')

  // Navigator (#214): hidden at rest, shown by a scroll, one tap = one message.
  assert.ok(!snapshot().includes('content-desc="Message '), 'navigator stays hidden while the user is not scrolling')
  const dimensions = adb('shell', 'wm', 'size')
  const [, width, height] = dimensions.match(/Override size: (\d+)x(\d+)/) ?? dimensions.match(/Physical size: (\d+)x(\d+)/) ?? []
  assert.ok(width && height)
  // Inverted list: dragging the finger DOWN reveals older messages, and that
  // drag is what has to wake the panel. uiautomator dumps take ~1s here, so the
  // tap is taken from the same dump that proved the panel is up.
  const wakeNavigator = async () => {
    for (let i = 0; i < 3; i++) {
      adb('shell', 'input', 'swipe', String(Math.floor(+width / 2)), String(Math.floor(+height * 0.35)), String(Math.floor(+width / 2)), String(Math.floor(+height * 0.75)), '300')
      await sleep(400)
      const xml = snapshot()
      if (xml.includes('resource-id="nav-up"')) return xml
    }
    throw new Error('dragging the transcript did not show the navigator')
  }

  let shown = await wakeNavigator()
  for (const id of ['nav-up', 'nav-down', 'nav-latest']) {
    assert.ok(shown.includes(`resource-id="${id}"`), `navigator exposes ${id}`)
  }
  // Evidence shot first, then wake it again: a screencap plus dump takes longer
  // than the panel's grace period, so the tap has to come from a fresh dump.
  screenshot('navigator-shown')
  shown = await wakeNavigator()
  const counterBefore = counterValue(shown)
  assert.match(counterBefore ?? '', /^\d+ \/ \d+$/, 'counter reads N / M')
  assert.ok(tapBounds(shown, n => n.includes('resource-id="nav-up"')), 'tap one message up')
  await sleep(800)
  // The tap wakes the panel itself, so it must still be up for the next dump —
  // no second swipe here, or the counter would move for the wrong reason.
  let after
  for (let i = 0; i < 3 && !after; i++) {
    const xml = snapshot()
    if (xml.includes('resource-id="nav-counter"')) after = xml
  }
  assert.ok(after, 'the navigator stays up after a tap')
  const counterAfter = counterValue(after)
  assert.equal(
    Number.parseInt(counterAfter, 10),
    Number.parseInt(counterBefore, 10) - 1,
    `one tap moves exactly one message (${counterBefore} -> ${counterAfter})`,
  )
  screenshot('navigator-one-up')
  assert.ok(tapBounds(after, n => n.includes('resource-id="nav-latest"')), 'tap back to the latest message')
  await sleep(900)
  await waitFor('OFFLINE_ANSWER_42')
  await sleep(4000)
  assert.ok(!snapshot().includes('content-desc="Message '), 'navigator hides once scrolling stops')
  screenshot('navigator-hidden')

  await tap('model-chip')
  await waitFor('Select Model')
  await waitFor('Fixture Two')
  screenshot('model-picker-open')
  await tap('model-option-fix-m2')
  await waitFor('model-chip')
  assert.ok(!snapshot().includes('Select Model'), 'Picking a model closes the sheet')
  // The chip shows the model id, not the display name.
  await waitFor('m2')
  await tap('variant-chip')
  await waitFor('Reasoning Effort')
  await waitFor('variant-option-high')
  screenshot('variant-picker-open')
  await tap('variant-option-high')
  await waitFor('variant-chip')
  assert.ok(!snapshot().includes('Reasoning Effort'), 'Picking an effort closes the sheet')
  await waitFor('High')
  await screenshot('model-and-effort-selected')
  adb('shell', 'wm', 'size', '1920x1200')
  await sleep(2000)
  // A resize recreates the activity and Android restores the *previous* route,
  // so the deep link could land on the offline-history page instead of the
  // session. A cold start with the deep link has no stack to restore.
  adb('shell', 'am', 'force-stop', pkg)
  await sleep(800)
  await open('session/roadmap-session')
  await sleep(2500)
  await ensureSessionOpen()
  await waitFor('OFFLINE_ANSWER_42')
  await waitFor('tablet-session-sidebar')
  await dismissBlockingSheets()
  await waitFor('tablet-session-sidebar')
  await waitFor('tablet-session-tablet-session-two')
  assert.ok(!snapshot().includes('Select Model'), 'Model sheet must not cover the tablet sidebar')
  await tap('tablet-session-tablet-session-two')
  await waitFor('TABLET_SECOND_ANSWER_44')
  await waitFor('TABLET_SESSION_TWO')
  await dismissBlockingSheets()
  await tap('tablet-session-roadmap-session')
  await waitFor('OFFLINE_ANSWER_42')
  screenshot('session-tablet-landscape')
  const split = snapshot()
  const sidebar = split.match(/<node\b[^>]*resource-id="tablet-session-sidebar"[^>]*>/)?.[0]
  assert.ok(sidebar, 'Sidebar has a real native layout node')
  const bounds = sidebar.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
  assert.ok(bounds && +bounds[3] - +bounds[1] === 280, 'Sidebar is 280 dp at mdpi')
  adb('shell', 'wm', 'size', '800x1280')
  await sleep(1500)
  await waitFor('OFFLINE_ANSWER_42')
  assert.ok(!snapshot().includes('tablet-session-sidebar'), 'Portrait 800 dp returns to one content pane')
  screenshot('session-tablet-portrait')
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  adb('shell', 'am', 'force-stop', pkg)
  await open('history')
  await tap('history-session-roadmap-session')
  await waitFor('OFFLINE_ANSWER_42')
  await waitFor('OFFLINE_QUESTION_42')
  assert.ok(!snapshot().includes('chat-send-button'), 'Offline transcript is read only')
  screenshot('offline-after-cold-restart')
  await tap('history-clear')
  await tap('Delete')
  await waitFor('No saved conversations yet.')
  screenshot('history-cleared')
  writeFileSync(`${out}/requests.json`, JSON.stringify(requests, null, 2))
  writeFileSync(`${out}/result.json`, JSON.stringify({ result: 'PASS', checks: ['tunnel-commands', 'reject-http-before-network', 'v2-connect', 'live-session-text', 'model-picker-select', 'effort-picker-select', 'tablet-split', 'tablet-portrait', 'offline-cold-restart', 'read-only', 'clear-history'] }, null, 2))
  console.log('PASS: Android tunnel, tablet and offline history CUA smoke')
} catch (error) {
  screenshot('failure')
  // A JS exception inside the sheet only reaches logcat; without it a failed
  // run says "UI did not contain Select Model" and nothing more.
  try {
    writeFileSync(`${out}/logcat.txt`, adb('logcat', '-d', '-t', '400', '-s', 'ReactNativeJS:V', 'AndroidRuntime:E'))
  } catch {}
  throw error
} finally {
  server.closeAllConnections()
  server.close()
  adb('shell', 'wm', 'size', 'reset')
  adb('shell', 'wm', 'density', 'reset')
}

