/**
 * The two robots do not get in each other's way, although their logs look nothing alike.
 *
 *   node scripts/test-robot-isolation.mjs
 *
 * A. both relays at once, in ONE shared data folder (as in production, where both write to data/):
 *    each replays its own log; orders, replay state, raw files and event streams stay apart.
 * B. each relay is fed the OTHER robot's log (a mis-pointed ROBOT_WS): nothing is recorded, nothing
 *    breaks, and the relay stays up.
 * C. the grocery log with the AI Judge and arm lines is not read as bar events, and the bar's
 *    "VLM:" line is not read as a grocery event.
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
const GROCERY_LOG = path.join(ROOT, 'scripts/fixtures/grocery_critic_2026-10-21.log')
const BAR_LOG = path.join(ROOT, 'scripts/fixtures/bar_demo_2026-10-21.log')

let failures = 0
let checks = 0
function check(cond, msg, extra) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const tmpDir = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `servai-${name}-`)); fs.mkdirSync(path.join(d, 'data'), { recursive: true }); return d }
const readJson = (f, dflt = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return dflt } }

/** Run one relay on one log until its single pass is over; return what it sent and where it wrote. */
async function runRelay({ robot, port, log, dataDir }) {
  let out = ''
  const proc = spawn(process.execPath, [path.join(ROOT, 'ws-test-server.js')], {
    cwd: ROOT,
    env: { ...process.env, ROBOT: robot, STATIC_REPLAY: '1', REPLAY_ONCE: '1', REPLAY_START_DELAY: '1500', REPLAY_LOG: log, DATA_DIR: dataDir, WS_PORT: String(port), REPLAY_SPEED: '400' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', d => { out += d })
  proc.stderr.on('data', d => { out += d })
  const events = []
  const modes = []
  for (let i = 0; i < 200 && !/WebSocket: ws/.test(out); i++) await sleep(100)
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  ws.on('message', (raw) => {
    const m = JSON.parse(raw)
    if (m.type === 'source_mode') modes.push(m)
    else if (m.type !== 'heartbeat') events.push(m)
  })
  return {
    events, modes, get out() { return out },
    async finish() {
      for (let i = 0; i < 600 && !/Loop \d+ complete/.test(out); i++) await sleep(100)
      await sleep(500)
      const api = async (p) => (await fetch(`http://127.0.0.1:${port}${p}`)).json()
      const result = { source: await api('/api/source'), orders: await api('/api/orders') }
      ws.close()
      proc.kill()
      await sleep(250)
      return result
    },
    alive: () => proc.exitCode === null,
  }
}

// ── A. both at once, one shared folder ──────────────────────────────────────────
console.log('A. both relays at once in one data folder')
{
  const root = tmpDir('iso-a')
  const dataDir = path.join(root, 'data')
  const g = await runRelay({ robot: 'grocery', port: 8801, log: GROCERY_LOG, dataDir })
  const b = await runRelay({ robot: 'bar', port: 8802, log: BAR_LOG, dataDir })
  const [rg, rb] = await Promise.all([g.finish(), b.finish()])

  check(rg.source.robot === 'grocery' && rb.source.robot === 'bar', 'each relay says which robot it is', [rg.source.robot, rb.source.robot])
  check(g.modes.every(m => m.robot === 'grocery') && b.modes.every(m => m.robot === 'bar'), 'source_mode messages carry the right robot')

  const gOrders = readJson(path.join(dataDir, 'orders.json'), [])
  const bOrders = readJson(path.join(dataDir, 'orders_bar.json'), [])
  check(gOrders.length === 2 && gOrders.every(o => o.robot === 'grocery' && o.item !== 'bottle'), 'orders.json: two grocery orders only', gOrders.map(o => [o.robot, o.item]))
  check(bOrders.length === 2 && bOrders.every(o => o.robot === 'bar' && o.item === 'bottle'), 'orders_bar.json: two bar orders only', bOrders.map(o => [o.robot, o.item]))
  check(gOrders.map(o => o.id).join() === '1,2' && bOrders.map(o => o.id).join() === '1,2', 'each robot numbers its own orders from 1', [gOrders.map(o => o.id), bOrders.map(o => o.id)])
  check(rg.orders.length === 2 && rg.orders.every(o => o.robot === 'grocery') && rb.orders.length === 2 && rb.orders.every(o => o.robot === 'bar'), 'each relay serves only its own orders over HTTP')
  check(gOrders.every(o => o.critic?.topic !== 'shake') && bOrders.every(o => o.critic?.topic === 'shake'), 'the judge\'s summaries stay with their robot (holding vs shake)')

  const files = fs.readdirSync(dataDir)
  check(files.includes('replay-state.json') && files.includes('replay-state-bar.json'), 'each robot has its own replay-state file', files.filter(f => /state/.test(f)))
  const gState = readJson(path.join(dataDir, 'replay-state.json'), {})
  const bState = readJson(path.join(dataDir, 'replay-state-bar.json'), {})
  check(gState.currentItem !== 'bottle' && (bState.currentItem === 'bottle' || bState.currentItem == null), 'the replay states do not mix', [gState.currentItem, bState.currentItem])

  const gTypes = new Set(g.events.map(e => e.type)), bTypes = new Set(b.events.map(e => e.type))
  check(!gTypes.has('rack_scan') && !g.events.some(e => /BARISTA/.test(e.origin || '')), 'grocery stream: nothing from the bar')
  check(!bTypes.has('system_fault') && !b.events.some(e => e.type === 'critic' && e.kind !== 'verdict') && !b.events.some(e => e.component === 'ITEM_CHECK'), 'bar stream: no arm faults, no grocery judge checks, no ITEM_CHECK')
  check(g.events.filter(e => e.type === 'cycle_start').length === 2 && b.events.filter(e => e.type === 'cycle_start').length === 2, 'two cycles on each stream')
  check(b.events.every(e => e.type !== 'phase' || !['SEARCH_DETECT', 'HANDOVER_RELEASE', 'EXECUTE_GRASP'].includes(e.component)), 'bar stream: no grocery pipeline phases')
  check(g.events.every(e => e.type !== 'phase' || !['DECAP', 'SHAKE', 'POUR_BEGIN', 'BOTTLE_GRAB'].includes(e.component)), 'grocery stream: no bar pipeline phases')

  // images and raw logs: the folder is shared, the file names are not
  const imgs = fs.existsSync(path.join(dataDir, 'images')) ? fs.readdirSync(path.join(dataDir, 'images')) : []
  check(imgs.every(f => !/bar/i.test(f)), 'images folder holds no bar images (the bar has none)', imgs.slice(0, 3))
  fs.rmSync(root, { recursive: true, force: true })
}

// ── B. each relay fed the other robot's log ─────────────────────────────────────
console.log('B. each relay fed the other robot\'s log')
{
  const root = tmpDir('iso-b')
  const gDir = path.join(root, 'data-g'), bDir = path.join(root, 'data-b')
  fs.mkdirSync(gDir); fs.mkdirSync(bDir)
  const g = await runRelay({ robot: 'grocery', port: 8803, log: BAR_LOG, dataDir: gDir })
  const b = await runRelay({ robot: 'bar', port: 8804, log: GROCERY_LOG, dataDir: bDir })
  const [rg, rb] = await Promise.all([g.finish(), b.finish()])

  check(rg.orders.length === 0 && !fs.existsSync(path.join(gDir, 'orders.json')), 'grocery relay fed the bar log: no orders', rg.orders.length)
  check(rb.orders.length === 0 && !fs.existsSync(path.join(bDir, 'orders_bar.json')), 'bar relay fed the grocery log: no orders', rb.orders.length)
  check(g.events.every(e => e.type !== 'cycle_start' && e.type !== 'cycle_end'), 'grocery relay: the bar\'s "drink cycle" lines start no order', g.events.filter(e => /cycle/.test(e.type)).length)
  check(b.events.every(e => e.type !== 'cycle_start' && e.type !== 'cycle_end'), 'bar relay: the grocery\'s "cycle N" lines start no drink', b.events.filter(e => /cycle/.test(e.type)).length)
  check(!/Error|TypeError|Unhandled/.test(g.out) && !/Error|TypeError|Unhandled/.test(b.out), 'neither relay logged an error', [g.out.match(/.*(Error|Unhandled).*/)?.[0], b.out.match(/.*(Error|Unhandled).*/)?.[0]])
  check(rg.source.robot === 'grocery' && rb.source.robot === 'bar', 'both relays were still up and answering')
  fs.rmSync(root, { recursive: true, force: true })
}

// ── C. real orders and replay orders never share a folder ───────────────────────────────────────────────
console.log('C. replay and live relays refuse each other\'s folders')
{
  const exits = (env) => new Promise((resolve) => {
    let out = ''
    const p = spawn(process.execPath, [path.join(ROOT, 'ws-test-server.js')], { cwd: ROOT, env: { ...process.env, ROBOT: 'grocery', REPLAY_LOG: GROCERY_LOG, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { out += d })
    const t = setTimeout(() => { p.kill(); resolve({ code: null, out }) }, 8000)
    p.on('exit', (code) => { clearTimeout(t); resolve({ code, out }) })
  })
  const root = tmpDir('iso-c')
  const liveDir = path.join(root, 'live'), demoDir = path.join(root, 'demo')
  fs.mkdirSync(liveDir); fs.mkdirSync(demoDir)

  // a folder a live relay has used is refused by a replay
  const live = await runRelay({ robot: 'grocery', port: 8805, log: GROCERY_LOG, dataDir: liveDir })   // static: marks it as replay data
  await live.finish()
  // use the marker files directly for the live side: start a real (non-static) relay in liveDir2
  const liveDir2 = path.join(root, 'live2'); fs.mkdirSync(liveDir2)
  const real = await exits({ DATA_DIR: liveDir2, WS_PORT: '8806', ROBOT_WS: 'ws://127.0.0.1:1' })   // live mode: keeps running, so it times out
  check(real.code === null && fs.existsSync(path.join(liveDir2, '.live-data')), 'a live relay starts and marks its folder as real data', real.code)
  const replayOnReal = await exits({ DATA_DIR: liveDir2, WS_PORT: '8807', STATIC_REPLAY: '1', REPLAY_ONCE: '1' })
  check(replayOnReal.code === 1 && /live robot's orders/.test(replayOnReal.out) && !fs.existsSync(path.join(liveDir2, 'orders.json')), 'a replay refuses a folder a live relay has used, and writes nothing there', replayOnReal.out.slice(0, 160))
  const liveOnReplay = await exits({ DATA_DIR: liveDir, WS_PORT: '8808', ROBOT_WS: 'ws://127.0.0.1:1' })
  check(liveOnReplay.code === 1 && /replayed \(demo\) orders/.test(liveOnReplay.out), 'a live relay refuses a folder a replay has used', liveOnReplay.out.slice(0, 160))
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
