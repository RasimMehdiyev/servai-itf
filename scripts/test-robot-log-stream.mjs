/**
 * robot-log-stream.py (the robot-side streamer) → relay (live) → orders_bar.json.
 *
 *   node scripts/test-robot-log-stream.mjs
 *
 * A "robot" appends lines to a log file the way bar_demo.log grows — structured lines mixed with
 * unrelated noise — while the streamer serves it over WebSocket and the bar relay follows it live.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STREAM_PORT = 17878
const RELAY_PORT = 8794
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'servai-stream-'))
const dataDir = path.join(tmp, 'data')
fs.mkdirSync(dataDir, { recursive: true })
const robotLog = path.join(tmp, 'bar_demo.log')
fs.writeFileSync(robotLog, 'earlier output that is already in the file\n')

const py = ['py', 'python3', 'python'].find(c => spawnSync(c, ['--version']).status === 0)
if (!py) { console.log('no Python found, skipping'); process.exit(0) }

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

let streamOut = ''
const streamer = spawn(py, [path.join(ROOT, 'scripts/robot-log-stream.py'), robotLog, '--port', String(STREAM_PORT)], { stdio: ['ignore', 'pipe', 'pipe'] })
streamer.stdout.on('data', d => { streamOut += d })
streamer.stderr.on('data', d => { streamOut += d })

let relayOut = ''
const relay = spawn(process.execPath, [path.join(ROOT, 'ws-test-server.js')], {
  cwd: ROOT,
  env: { ...process.env, ROBOT: 'bar', ROBOT_WS_BAR: `ws://127.0.0.1:${STREAM_PORT}`, DATA_DIR: dataDir, WS_PORT: String(RELAY_PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
relay.stdout.on('data', d => { relayOut += d })
relay.stderr.on('data', d => { relayOut += d })

const get = async (p) => (await fetch(`http://127.0.0.1:${RELAY_PORT}${p}`)).json()

try {
  check(await waitFor(() => /streaming .* on ws:/.test(streamOut), 10000, 'streamer start'), 'the streamer starts', streamOut)
  check(await waitFor(() => /Connected to robot at ws:\/\/127\.0\.0\.1:17878/.test(relayOut), 40000, 'relay connection'), 'the relay (ROBOT_WS_BAR) connects to the streamer')
  check((await get('/api/source')).mode === 'live', 'the relay is live')

  // the robot writes its log: structured lines plus noise a grep would drop
  const lines = fs.readFileSync(path.join(ROOT, 'scripts/fixtures/bar_demo_2026-10-21.log'), 'utf8').split(/\r?\n/).filter(Boolean)
  let n = 0
  for (const l of lines) {
    fs.appendFileSync(robotLog, l + '\n')
    if (++n % 4 === 0) fs.appendFileSync(robotLog, '127.0.0.1 - - [21/Oct/2026 15:00:00] "GET /api/health HTTP/1.1" 200 -\n')
    await sleep(8)
  }
  check(await waitFor(async () => (await get('/api/orders')).length >= 2, 20000, 'two orders'), 'two drinks written to the log arrive as two saved orders', (await get('/api/orders')).length)
  const orders = await get('/api/orders')
  check(orders.every(o => o.robot === 'bar' && o.status === 'warning' && o.failure?.reason === 'bottles_empty'), 'orders read as they should', orders.map(o => [o.status, o.failure?.reason]))
  const rawFiles = fs.existsSync(path.join(dataDir, 'logs')) ? fs.readdirSync(path.join(dataDir, 'logs')) : []
  const raw = rawFiles.length ? fs.readFileSync(path.join(dataDir, 'logs', rawFiles[0]), 'utf8') : ''
  check(!/api\/health|earlier output/.test(raw), 'noise and old lines were not streamed (only the structured lines)')
  check(/drink cycle 1/.test(raw), 'the structured lines were')

  // restart the streamer: the relay finds it again
  streamer.kill()
  await sleep(500)
  const again = spawn(py, [path.join(ROOT, 'scripts/robot-log-stream.py'), robotLog, '--port', String(STREAM_PORT)], { stdio: ['ignore', 'pipe', 'pipe'] })
  check(await waitFor(() => (relayOut.match(/Connected to robot at/g) || []).length >= 2, 40000, 'reconnect'), 'the relay reconnects when the streamer comes back')
  again.kill()
} finally {
  streamer.kill()
  relay.kill()
  await sleep(300)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failures ? 1 : 0)
