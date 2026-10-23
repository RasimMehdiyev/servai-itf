/**
 * The relay's LIVE connection to a robot, tried against a fake robot (scripts/fake-robot.cjs).
 * This is the path used when a real robot is connected — the replay tests do not exercise it.
 *
 *   node scripts/test-bar-live.mjs
 *
 *  1. relay for the bar starts before any robot exists → it reports "waiting" and keeps retrying
 *  2. a robot appears (frames carry 3 log lines each) → the relay connects without a restart, goes
 *     "live", saves orders to orders_bar.json and writes the raw log
 *  3. the first drink in the stream is clean, the second hits the empty rack → success + warning
 *  4. the robot disappears → "waiting" again; it comes back, now tagging every line with
 *     "[orchestrator] " → the relay reconnects and still understands it
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const WebSocket = require('ws')

const RELAY_PORT = 8793
const ROBOT_PORT = 17899
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'servai-live-'))
const dataDir = path.join(tmp, 'data')
fs.mkdirSync(dataDir, { recursive: true })

// First drink without the refill failure (a clean pour), second as recorded.
const fixture = fs.readFileSync(path.join(ROOT, 'scripts/fixtures/bar_demo_2026-10-21.log'), 'utf8').split(/\r?\n/)
const firstBottleFail = fixture.findIndex(l => l.includes('BARISTA:BOTTLE | FAIL'))
const variant = fixture.filter((_, i) => i !== firstBottleFail).map(l => l.replace('poured 0.2 of drinks', (m) => m)).join('\n')
const clean = path.join(tmp, 'bar_clean_first.log')
fs.writeFileSync(clean, variant)

let failures = 0
let checks = 0
const check = (cond, msg, extra) => { checks++; if (!cond) { failures++; console.log(`  FAIL  ${msg}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`) } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function waitFor(fn, ms, label) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(100) }
  console.log(`  timeout waiting for ${label}`)
  return false
}

let relayOut = ''
let relay = null
function startRelay() {
  relay = spawn(process.execPath, [path.join(ROOT, 'ws-test-server.js')], {
    cwd: ROOT,
    env: { ...process.env, ROBOT: 'bar', ROBOT_WS: `ws://127.0.0.1:${ROBOT_PORT}`, DATA_DIR: dataDir, WS_PORT: String(RELAY_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  relay.stdout.on('data', d => { relayOut += d })
  relay.stderr.on('data', d => { relayOut += d })
}
startRelay()

let robot = null
function startRobot(logFile, extra = []) {
  robot = spawn(process.execPath, [path.join(ROOT, 'scripts/fake-robot.cjs'), logFile, '--port', String(ROBOT_PORT), '--speed', '300', ...extra], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  robot.stdout.on('data', d => { out += d })
  robot.stderr.on('data', d => { out += d })
  return () => out
}
const stopRobot = async () => { if (robot) { robot.kill(); robot = null; await sleep(300) } }

const get = async (p) => (await fetch(`http://127.0.0.1:${RELAY_PORT}${p}`)).json()
const events = []
const modes = []
let dash = null

try {
  await waitFor(() => /WebSocket: ws/.test(relayOut), 15000, 'relay start')
  check(await waitFor(() => /Connecting to robot at ws:\/\/127\.0\.0\.1:17899/.test(relayOut), 5000, 'first connection attempt'), 'the relay tries the robot address from ROBOT_WS')

  // dashboard client, as the browser would be
  dash = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}`)
  dash.on('message', (raw) => {
    const m = JSON.parse(raw)
    if (m.type === 'source_mode') modes.push(m.mode)
    else if (m.type !== 'heartbeat') events.push(m)
  })
  await waitFor(() => modes.length > 0, 5000, 'first source_mode')
  check(modes[0] === 'waiting', 'with no robot the relay reports "waiting"', modes)
  check((await get('/api/source')).mode === 'waiting', '/api/source says waiting')

  // ── 1. robot appears, frames of three lines ──────────────────────────────────
  startRobot(clean, ['--batch', '3'])
  check(await waitFor(() => modes.includes('live'), 25000, 'relay to connect and go live'), 'the relay connects once the robot is up, without a restart', modes)
  check(await waitFor(() => events.filter(e => e.type === 'cycle_end').length >= 2, 25000, 'two drinks'), 'two drink cycles arrive live', events.filter(e => e.type === 'cycle_end').length)
  await sleep(500)
  check((await get('/api/source')).mode === 'live', '/api/source says live')

  let orders = (await get('/api/orders'))
  check(orders.length === 2, 'two orders saved in orders_bar.json', orders.length)
  check(orders[0]?.status === 'success' && !orders[0]?.failure, 'a drink without the empty-rack failure is saved as success', [orders[0]?.status, orders[0]?.failure])
  check(orders[1]?.status === 'warning' && orders[1]?.failure?.reason === 'bottles_empty', 'the drink that finds the rack empty is saved as warning (bottles_empty)', [orders[1]?.status, orders[1]?.failure?.reason])
  check(orders.every(o => o.robot === 'bar' && o.item === 'bottle'), 'orders belong to the bar')
  check(orders[0]?.bottle === 0 && orders[1]?.bottle === 1, 'bottle numbers come from the rack holes', [orders[0]?.bottle, orders[1]?.bottle])
  check(orders.every(o => o.steps.length === 6), 'every order has its six steps', orders.map(o => o.steps.length))
  check(!fs.existsSync(path.join(dataDir, 'orders.json')), 'no grocery orders file was created')

  // raw log: everything the robot sent is kept
  const logDir = path.join(dataDir, 'logs')
  const logs = fs.existsSync(logDir) ? fs.readdirSync(logDir) : []
  check(logs.some(f => f.startsWith('robot-bar-')), 'the raw robot log is saved as robot-bar-<day>.log', logs)
  const raw = logs.length ? fs.readFileSync(path.join(logDir, logs[0]), 'utf8') : ''
  check(/BARISTA:RACK_SCAN/.test(raw) && /drink cycle 2/.test(raw), 'the raw log holds the lines as sent (one per line, frames split)')

  // ── 2. robot disappears and comes back, now with a process tag on every line ──
  const before = modes.length
  await stopRobot()
  check(await waitFor(() => modes.slice(before).includes('waiting'), 15000, 'waiting after the robot left'), 'the relay notices the robot is gone and reports "waiting"', modes.slice(before))
  const before2 = modes.length
  const robotOut = startRobot(path.join(ROOT, 'scripts/fixtures/bar_demo_2026-10-21.log'), ['--prefix', '[orchestrator] '])
  check(await waitFor(() => modes.slice(before2).includes('live'), 40000, 'reconnect'), 'the relay reconnects by itself when the robot returns', modes.slice(before2))
  check(await waitFor(async () => (await get('/api/orders')).length >= 4, 25000, 'two more orders'), 'lines tagged "[orchestrator] " are understood too', (await get('/api/orders')).length)
  orders = await get('/api/orders')
  check(orders.slice(2).every(o => o.status === 'warning' && o.failure?.reason === 'bottles_empty'), 'the tagged stream produced the same two warnings', orders.slice(2).map(o => o.status))
  check(orders.map(o => o.id).join(',') === '1,2,3,4', 'order numbers carry on', orders.map(o => o.id))
  console.log(`  relay saw: ${modes.join(' → ')}`)
  void robotOut

  // ── 3. the relay restarts: the history of completed orders is still there ───────
  await stopRobot()
  relay.kill()
  await sleep(500)
  relayOut = ''
  startRelay()
  check(await waitFor(() => /WebSocket: ws/.test(relayOut), 15000, 'relay restart'), 'the relay starts again')
  orders = await get('/api/orders')
  check(orders.map(o => o.id).join(',') === '1,2,3,4', 'after a restart the four earlier orders are still listed', orders.map(o => o.id))
  const mark = modes.length
  startRobot(clean, ['--batch', '3'])
  dash.close()
  dash = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}`)
  dash.on('message', (raw) => { const m = JSON.parse(raw); if (m.type === 'source_mode') modes.push(m.mode) })
  check(await waitFor(async () => (await get('/api/orders')).length >= 6, 40000, 'two new orders after restart'), 'new orders are added after the earlier ones', (await get('/api/orders')).length)
  orders = await get('/api/orders')
  check(orders.map(o => o.id).join(',') === '1,2,3,4,5,6', 'order numbers continue from where they stopped', orders.map(o => o.id))
  void mark
} finally {
  if (dash) dash.close()
  await stopRobot()
  if (relay) relay.kill()
  await sleep(200)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failures ? 1 : 0)
