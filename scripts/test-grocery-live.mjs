/**
 * The grocery relay's LIVE connection, with the newest log (AI Judge + arm fault).
 *
 *   node scripts/test-grocery-live.mjs
 *
 *  1. a fake robot streams scripts/fixtures/grocery_critic_2026-10-21.log, three lines per frame, every
 *     line tagged with its process ([orchestrator], [critic-service]) → the relay turns it into
 *     two orders, the judge's events and the arm faults, exactly as in a replay
 *  2. the robot-side streamer (robot-log-stream.py) follows a log file that also holds a lot of noise
 *     (vLLM start-up, tactile-sensor warnings, planner chatter): the structured lines, the judge's
 *     lines and the arm's lines get through, the noise does not
 *  3. the relay restarts: the orders written so far are still there
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const WebSocket = require('ws')
const FIXTURE = path.join(ROOT, 'scripts/fixtures/grocery_critic_2026-10-21.log')

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
const procs = []
const run = (cmd, args, env = {}) => {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  p.output = ''
  p.stdout.on('data', d => { p.output += d })
  p.stderr.on('data', d => { p.output += d })
  procs.push(p)
  return p
}

async function liveRun({ label, startRobot, port, robotPort, dataDir }) {
  const relay = run(process.execPath, [path.join(ROOT, 'ws-test-server.js')], { ROBOT: 'grocery', ROBOT_WS: `ws://127.0.0.1:${robotPort}`, DATA_DIR: dataDir, WS_PORT: String(port) })
  await waitFor(() => /WebSocket: ws/.test(relay.output), 15000, 'relay start')
  const events = []
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.type !== 'heartbeat' && m.type !== 'source_mode') events.push(m) })
  const robot = await startRobot()
  const get = async (p) => (await fetch(`http://127.0.0.1:${port}${p}`)).json()
  const got = await waitFor(async () => (await get('/api/orders')).length >= 2, 60000, `${label}: two orders`)
  await sleep(1500)   // the arm faults come after the last order
  ws.close()
  return { relay, robot, events, orders: await get('/api/orders'), got, get }
}

try {
  // ── 1. fake robot, tagged lines, three per frame ──────────────────────────────
  console.log('1. fake robot → relay (live)')
  const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'servai-glive-'))
  const r1 = await liveRun({
    label: 'fake robot', dataDir: dir1, port: 8811, robotPort: 17898,
    startRobot: async () => {
      const p = run(process.execPath, [path.join(ROOT, 'scripts/fake-robot.cjs'), FIXTURE, '--port', '17898', '--speed', '300', '--batch', '3'])
      await waitFor(() => /on ws:/.test(p.output), 8000, 'fake robot start')
      return p
    },
  })
  const kinds = {}
  for (const e of r1.events.filter(e => e.type === 'critic')) kinds[e.kind] = (kinds[e.kind] || 0) + 1
  check(r1.got && r1.orders.length === 2, 'two orders arrive over the live connection', r1.orders.length)
  check(r1.orders[0]?.status === 'success' && r1.orders[0].critic?.verdict === 'holding', 'order 1: delivered, the judge confirmed the grip', [r1.orders[0]?.status, r1.orders[0]?.critic?.verdict])
  check(r1.orders[1]?.status === 'failed' && r1.orders[1].failure?.reason === 'arm_fault' && r1.orders[1].failure.at_phase === 'handing_over', 'order 2: failed, arm fault in the handover', r1.orders[1]?.failure)
  check(kinds.check >= 14 && kinds.phase >= 10 && kinds.roi === 2, 'the judge\'s events arrive live (batched frames, tagged lines)', kinds)
  check(r1.events.filter(e => e.type === 'system_fault' && e.source === 'arm').length >= 4, 'the arm faults arrive live')
  const raw1 = fs.readdirSync(path.join(dir1, 'logs')).map(f => fs.readFileSync(path.join(dir1, 'logs', f), 'utf8')).join('\n')
  check(/\[critic-service\]/.test(raw1) && /FRC_SystemFault/.test(raw1), 'the raw log keeps the judge\'s and the arm\'s lines as sent')
  r1.robot.kill(); r1.relay.kill(); await sleep(300)

  // ── 2. the streamer on the robot, with noise ──────────────────────────────────
  const py = ['py', 'python3', 'python'].find(c => spawnSync(c, ['--version']).status === 0)
  if (!py) {
    console.log('2. (no Python found, skipping the streamer)')
  } else {
    console.log('2. robot-log-stream.py (with noise) → relay (live)')
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'servai-glive2-'))
    const robotLog = path.join(dir2, 'grocery-up.log')
    fs.writeFileSync(robotLog, 'earlier output\n')
    const noise = [
      '[critic-vllm] (EngineCore pid=3989250) INFO 10-21 17:10:19 [model_runner.py:424] Model loading took 4.66 GiB memory',
      '[fingertip] 2026-10-21 17:13:45.564 | WARNING  | sensor_comm_dds.communication.readers.magtouch_ble_reader:data_convert:147 - sensor0 taxel3 axis y overflow',
      '[orchestrator] 2026-10-21 17:13:21.528 | INFO     | grocery_bot.planning.curobo_adapter:plan_to_joint_configuration:1338 - plan=LERP: 1.90s move',
      '[camera] INFO     | grocery_bot.camera.runner:main:50 | Camera started — publishing at ~15 FPS',
    ]
    const starter = async () => {
      const s = run(py, [path.join(ROOT, 'scripts/robot-log-stream.py'), robotLog, '--port', '17897'])
      await waitFor(() => /streaming .* on ws:/.test(s.output), 10000, 'streamer start')
      return s
    }
    const r2 = await liveRun({
      label: 'streamer', dataDir: dir2, port: 8812, robotPort: 17897,
      startRobot: async () => {
        const s = await starter()
        // wait for the relay to be connected, then let the "robot" write its log
        await waitFor(() => /client connected/.test(s.output), 40000, 'relay to connect to the streamer')
        const lines = fs.readFileSync(FIXTURE, 'utf8').split(/\r?\n/).filter(Boolean)
        ;(async () => {
          let n = 0
          for (const l of lines) {
            fs.appendFileSync(robotLog, l + '\n')
            if (++n % 3 === 0) fs.appendFileSync(robotLog, noise[n % noise.length] + '\n')
            await sleep(6)
          }
        })()
        return s
      },
    })
    const kinds2 = {}
    for (const e of r2.events.filter(e => e.type === 'critic')) kinds2[e.kind] = (kinds2[e.kind] || 0) + 1
    check(r2.got && r2.orders.length === 2, 'two orders arrive through the streamer', r2.orders.length)
    check(r2.orders[1]?.failure?.reason === 'arm_fault', 'order 2 is the arm fault, as with the fake robot', r2.orders[1]?.failure)
    check(kinds2.check >= 14 && kinds2.roi === 2, 'the judge\'s lines pass the streamer\'s default filter', kinds2)
    check(r2.events.some(e => e.type === 'system_fault' && e.source === 'arm'), 'the arm\'s lines pass the streamer\'s default filter')
    const raw2 = fs.readdirSync(path.join(dir2, 'logs')).map(f => fs.readFileSync(path.join(dir2, 'logs', f), 'utf8')).join('\n')
    check(!/EngineCore|magtouch|curobo_adapter|Camera started|earlier output/.test(raw2), 'the noise was filtered out by the streamer')
    r2.robot.kill(); r2.relay.kill(); await sleep(300)

    // ── 3. the relay restarts ───────────────────────────────────────────────────
    console.log('3. the relay restarts')
    const relay3 = run(process.execPath, [path.join(ROOT, 'ws-test-server.js')], { ROBOT: 'grocery', ROBOT_WS: 'ws://127.0.0.1:17896', DATA_DIR: dir2, WS_PORT: '8812' })
    await waitFor(() => /WebSocket: ws/.test(relay3.output), 15000, 'relay restart')
    const again = await (await fetch('http://127.0.0.1:8812/api/orders')).json()
    check(again.length === 2 && again.map(o => o.id).join() === '1,2', 'the two orders are still there after a restart', again.map(o => o.id))
    relay3.kill()
    fs.rmSync(dir2, { recursive: true, force: true })
  }
  fs.rmSync(dir1, { recursive: true, force: true })
} finally {
  for (const p of procs) { try { p.kill() } catch {} }
  await sleep(300)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
