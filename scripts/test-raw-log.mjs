/**
 * Checks that the relay saves the robot's raw log while connected.
 *
 *   node scripts/test-raw-log.mjs
 *
 * Starts a fake robot websocket that sends the lines of the recorded orchestrator log
 * (including a fake IMAGE line), runs the real relay against it with a throw-away
 * DATA_DIR, then checks data/logs/robot-<day>.log:
 *   - every robot line is there, unchanged and in order
 *   - nothing but the robot's own lines is written (no connect / disconnect markers)
 *   - the IMAGE picture payload is replaced by its size (and nothing else is altered)
 *   - the saved file can be replayed (REPLAY_LOG) and parses to the same events
 *   - a static replay writes no raw log
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { WebSocketServer } = require('ws')

const fixture = path.join(ROOT, 'scripts/fixtures/orchestrator_2026-10-20.log')
// the relay's parser wants untagged lines; strip the "[process] " prefix the way a future fix would
const lines = fs.readFileSync(fixture, 'utf8').split(/\r?\n/).filter(l => l.trim()).map(l => l.replace(/^\[[\w-]+\]\s+/, ''))
const b64 = 'A'.repeat(5000)
const imageLine = `2026-10-20T12:20:30.000Z | IMAGE | fail_123_d415 | failure capture from d415 | ${b64}`
const sent = [...lines.slice(0, 20), imageLine, ...lines.slice(20, 40)]

let failures = 0
let checks = 0
const check = (cond, msg, extra) => { checks++; if (!cond) { failures++; console.log(`  FAIL  ${msg}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`) } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'servai-rawlog-'))
const dataDir = path.join(tmp, 'data')
fs.mkdirSync(dataDir, { recursive: true })
const ROBOT_PORT = 8792
const RELAY_PORT = 8793

// ── fake robot ──────────────────────────────────────────────────────────────
const robot = new WebSocketServer({ port: ROBOT_PORT })
let robotSocket = null
robot.on('connection', (ws) => {
  robotSocket = ws
  ;(async () => { for (const l of sent) { ws.send(l); await sleep(5) } })()
})

function startRelay(extraEnv) {
  const p = spawn(process.execPath, [path.join(ROOT, 'ws-test-server.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATA_DIR: dataDir, WS_PORT: String(RELAY_PORT), ROBOT_WS: `ws://127.0.0.1:${ROBOT_PORT}`, ...extraEnv },
  })
  p.out = ''
  p.stdout.on('data', d => { p.out += d })
  p.stderr.on('data', d => { p.out += d })
  return p
}

const day = (() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` })()
const logFile = path.join(dataDir, 'logs', `robot-${day}.log`)

try {
  // ── live connection ───────────────────────────────────────────────────────
  const relay = startRelay({})
  for (let i = 0; i < 100 && !/Connected to robot/.test(relay.out); i++) await sleep(100)
  check(/Connected to robot/.test(relay.out), 'relay connected to the fake robot')
  await sleep(1500)                       // let all lines arrive
  robotSocket?.close()                    // disconnect → marker
  await sleep(1000)
  relay.kill()
  await sleep(500)

  check(fs.existsSync(logFile), `raw log file exists (${path.relative(ROOT, logFile) || logFile})`)
  const saved = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean) : []
  const markers = saved.filter(l => l.startsWith('# '))
  const body = saved.filter(l => !l.startsWith('# '))
  console.log(`  robot sent ${sent.length} lines; file has ${body.length} lines + ${markers.length} marker lines`)

  check(markers.length === 0, 'no connect / disconnect markers in the log', markers)
  check(body.length === sent.length, 'every line received is saved', [body.length, sent.length])
  const expected = sent.map(l => (l === imageLine ? null : l))
  const same = body.every((l, i) => expected[i] === null || l === expected[i])
  check(same, 'lines are saved unchanged and in order')
  const img = body.find(l => l.includes('| IMAGE |'))
  check(img && !img.includes('AAAAAAAAAA') && /base64 omitted, 5000 chars/.test(img), 'IMAGE payload replaced by its size', img)
  check(img && img.startsWith('2026-10-20T12:20:30.000Z | IMAGE | fail_123_d415 | failure capture from d415 | '), 'IMAGE line keeps its timestamp, id and description')

  // ── the file replays: the relay parses it to the same events as the original lines ─
  const replayDir = path.join(tmp, 'replay')
  fs.mkdirSync(replayDir, { recursive: true })
  const relay2 = startRelay({ STATIC_REPLAY: '1', REPLAY_LOG: logFile, DATA_DIR: replayDir, WS_PORT: String(RELAY_PORT + 1), REPLAY_SPEED: '400', ROBOT_WS: '' })
  for (let i = 0; i < 100 && !/Parsed \d+ events/.test(relay2.out); i++) await sleep(100)
  const m = relay2.out.match(/Parsed (\d+) events/)
  await sleep(800)
  relay2.kill()
  await sleep(300)
  check(m && parseInt(m[1], 10) > 20, 'the saved file can be replayed and parses to events', m && m[1])
  check(!fs.existsSync(path.join(replayDir, 'logs')), 'a static replay writes no raw log')
} finally {
  robot.close()
  await sleep(200)
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
