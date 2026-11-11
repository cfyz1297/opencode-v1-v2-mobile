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
function screenshot(name) {
  writeFileSync(`${out}/${name}.png`, execFileSync('adb', ['exec-out', 'screencap', '-p']))
  writeFileSync(`${out}/${name}.xml`, snapshot())
}
const now = Date.now()
const session = { id: 'roadmap-session', title: 'ROADMAP_SESSION', location: { directory: '/fixture' }, time: { created: now, updated: now } }
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
  else if (path === '/api/location') data = { directory: '/fixture', project: { directory: '/fixture' } }
  else if (path === '/api/session') data = { data: [session, other] }
  else if (path === '/api/session/tablet-session-two') data = { data: other }
  else if (path === '/api/session/tablet-session-two/message') data = { data: [{ id: 'a2', type: 'assistant', time: { created: now, completed: now }, content: [{ type: 'text', text: 'TABLET_SECOND_ANSWER_44' }] }] }
  else if (path === '/api/session/roadmap-session') data = { data: session }
  else if (path === '/api/session/roadmap-session/message') data = { data: [
    { id: 'a1', type: 'assistant', time: { created: now + 1, completed: now + 2 }, content: [{ type: 'text', text: 'OFFLINE_ANSWER_42' }] },
    { id: 'u1', type: 'user', time: { created: now }, text: 'OFFLINE_QUESTION_42' },
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
  // The chips are the only way to change model and reasoning effort, and a
  // sheet that silently never opens is invisible to the unit tests. Tapping
  // them, and checking the label really follows the choice, is the regression
  // guard for "model and effort selection stopped working".
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
  // Re-open the session after resize so a stolen back/sheet cannot leave history on top.
  await open('session/roadmap-session')
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

