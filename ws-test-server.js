/**
 * Replay WebSocket server — replays structured robot logs indistinguishably
 * from a live robot socket.
 *
 * Log format: timestamp | LEVEL | COMPONENT:ACTION | STATUS | details
 *
 * Usage:   node ws-test-server.js
 * Env:     REPLAY_SPEED=2.0   (default 1.0 = real-time)
 *          WS_PORT=8765
 *
 * Architecture:
 *   - ONE global replay loop, broadcasts to all connected clients
 *   - New clients receive a rapid catch-up burst of all events in the
 *     current cycle, then join the live stream
 *   - Heartbeats sent during long gaps so clients know the server is alive
 *   - Replay state persisted to disk so server restart resumes mid-cycle
 *
 * Also serves HTTP endpoints for the frontend.
 */

const { WebSocketServer, WebSocket } = require('ws')
const http = require('http')
const fs = require('fs')
const path = require('path')

// Settings for the relay may live in .env (ROBOT_WS, ROBOT_WS_BAR, WS_PORT, …); real environment
// variables win. A generic ROBOT_WS in .env belongs to the default robot only, so a second relay
// does not end up pointed at the first robot — use ROBOT_WS_<ID> (e.g. ROBOT_WS_BAR) for the others.
try {
  const early = process.env.ROBOT || 'grocery'
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*((?:ROBOT|WS_|RAW_LOG|REPLAY|LIVE_)[A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m || process.env[m[1]] !== undefined) continue
    if (m[1] === 'ROBOT_WS' && early !== 'grocery') continue
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no .env: fine */ }

// One relay per robot: ROBOT=grocery (default) | bar. Each robot has its own port, orders file
// and replay state (src/robots/robots.json), and its own log dialect (src/robots/serverProfile.cjs).
const ROBOTS = require('./src/robots/robots.json')
const ROBOT_ID = process.env.ROBOT || ROBOTS.default
const ROBOT = ROBOTS.robots[ROBOT_ID]
if (!ROBOT) {
  console.error(`Unknown ROBOT '${ROBOT_ID}'. Known robots: ${Object.keys(ROBOTS.robots).join(', ')}`)
  process.exit(1)
}
const PROFILE = require('./src/robots/serverProfile.cjs')(ROBOT_ID)

const PORT = parseInt(process.env.WS_PORT || String(ROBOT.port), 10)
const REPLAY_SPEED = parseFloat(process.env.REPLAY_SPEED || '1.0')
const ROBOT_WS = process.env[`ROBOT_WS_${ROBOT_ID.toUpperCase()}`] || process.env.ROBOT_WS || ROBOT.robotWs
const LIVE_RECONNECT_ATTEMPTS = parseInt(process.env.LIVE_RETRIES || '5', 10)
const ROBOT_PROBE_INTERVAL = 30_000  // check for robot every 30s while in static mode
// main-live is the real-connection-only branch: never replay grocery_logs.txt.
// The dashboard always tries to reach the real robot at ROBOT_WS and shows a
// "waiting for robot" state until it connects.
// Opt-in for tests only (STATIC_REPLAY=1): replay a log file into a throw-away
// DATA_DIR so the Live page can be checked against recorded robot logs without
// touching the real orders. The default stays real-connection-only.
const ENABLE_STATIC_REPLAY = process.env.STATIC_REPLAY === '1'
const LOG_FILE = process.env.REPLAY_LOG || path.join(__dirname, ROBOT.replayLog)
const ORDERS_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
const ORDERS_FILE = path.join(ORDERS_DIR, ROBOT.ordersFile)
const STATE_FILE = path.join(ORDERS_DIR, ROBOT.stateFile)

// ── Real data and replay data never share a folder ────────────────────────────────────────────────────
// A live relay writes the robot's real orders; a replay writes demo orders. If both ever used one orders file the
// real history would fill up with demo orders. So: a replay refuses the real data folder (and any folder a live
// relay has used), a live relay refuses data/replay/ (and any folder a replay has used). Each marks its folder.
{
  const dir = path.resolve(ORDERS_DIR)
  const realDir = path.resolve(__dirname, 'data')
  const replayRoot = path.join(realDir, 'replay')
  const liveMark = path.join(dir, '.live-data'), replayMark = path.join(dir, '.replay-data')
  const stop = (why) => { console.error(`\n  Refusing to start: ${why}\n`); process.exit(1) }
  if (process.env.STATIC_REPLAY === '1') {
    if (dir === realDir) stop('a replay would write demo orders into the real orders file (data/). Start it with npm run replay, which uses data/replay/<robot>/, or set DATA_DIR to another folder.')
    if (fs.existsSync(liveMark)) stop(`${dir} holds a live robot's orders; a replay must use a folder of its own.`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(replayMark, 'demo orders from a replayed log: never mix with the robot\'s real orders\n')
  } else {
    if (dir === replayRoot || dir.startsWith(replayRoot + path.sep)) stop(`${dir} is a replay folder; a live relay must not write the robot's real orders there.`)
    if (fs.existsSync(replayMark)) stop(`${dir} holds replayed (demo) orders; a live relay must use a folder of its own, normally data/.`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(liveMark, 'the robot\'s real orders: a replay must never write here\n')
  }
}
const LOOP_PAUSE = 5000
const HEARTBEAT_INTERVAL = 4000
// Longest pause between two replayed events. The default squeezes long gaps for quick demos;
// REPLAY_MAX_DELAY=<ms> (scripts/dev-replay.cjs sets it very high) keeps the log's own timing.
const SKIP_IDLE = process.env.REPLAY_SKIP_IDLE === '1'
const MAX_EVENT_DELAY = parseInt(process.env.REPLAY_MAX_DELAY || '5000', 10)

const CAPTION_CACHE_DIR = path.join(ORDERS_DIR, 'cache', 'captions')
const VISION_CACHE_DIR = path.join(ORDERS_DIR, 'cache', 'vision')

/**
 * Read the most recent cached caption for a given surface prefix.
 * Returns the parsed JSON or null.
 */
function readLatestCaption(surfacePrefix) {
  try {
    const files = fs.readdirSync(CAPTION_CACHE_DIR)
      .filter(f => f.startsWith(surfacePrefix + '_') && f.endsWith('.json'))
    if (files.length === 0) return null
    // Pick the most recently modified
    let best = null, bestMtime = 0
    for (const f of files) {
      const fp = path.join(CAPTION_CACHE_DIR, f)
      const mt = fs.statSync(fp).mtimeMs
      if (mt > bestMtime) { bestMtime = mt; best = fp }
    }
    if (!best) return null
    return JSON.parse(fs.readFileSync(best, 'utf-8'))
  } catch { return null }
}

// Source mode, broadcast to clients so the UI can label the feed:
//   'live'    — connected to the real robot WS
//   'static'  — replaying grocery_logs.txt (no robot, demo/test data)
//   'waiting' — no robot and static replay disabled (STATIC_REPLAY=0)
let sourceMode = 'waiting'

// ── Valid stock items (anything else is treated as accidental input) ─────────
const VALID_STOCK = ['pen', 'ball', 't-shirt', 'water bottle', 'phone holder', 'towel', 'sock', 'coffee mug', 'saddle cover', 'notebook', 'umbrella']
function isValidItem(name) {
  if (PROFILE.isValidItem) return PROFILE.isValidItem(name)
  const n = (name || '').toLowerCase().trim()
  return VALID_STOCK.some(v => n.includes(v) || v.includes(n))
}

// ── Phase mapping (mirrors src/lib/phases.js) ───────────────────────────────

const PHASES = PROFILE.phases || [
  { phase: 'scene_scan',    friendly_name: 'Scanning the scene',  components: ['SCENE_SCAN'] },
  { phase: 'searching',     friendly_name: 'Searching for item',  components: ['SEARCH_DETECT'] },
  { phase: 'anchor_select', friendly_name: 'Selecting target',    components: ['ANCHOR_SELECT'] },
  { phase: 'closeup_move',  friendly_name: 'Moving closer',       components: ['CLOSEUP_MOVE'] },
  { phase: 'analyzing',     friendly_name: 'Analyzing the grasp', components: ['CLOSEUP_MOLMO', 'CLOSEUP_REFINE', 'CLOSEUP_LIFT', 'SYNTHESISE', 'VISUALISE'] },
  { phase: 'grasping',      friendly_name: 'Picking up',          components: ['EXECUTE_GRASP', 'CLOSEUP_RETRY'] },
  { phase: 'bringing_over', friendly_name: 'Bringing it over',    components: ['ITEM_CHECK', 'HANDOVER_TRANSIT', 'HANDOVER_MOVE'] },
  { phase: 'handing_over',  friendly_name: 'Handing over',        components: ['HANDOVER_RELEASE'] },
  { phase: 'returning',     friendly_name: 'Returning',           components: ['HANDOVER_RETURN', 'RETURN_HOME'] },
]

const _compToPhase = {}
for (const p of PHASES) for (const c of p.components) _compToPhase[c] = p

// ── Failure classification ───────────────────────────────────────────────────

function classifyFailure(detail) {
  if (PROFILE.classifyFailure) return PROFILE.classifyFailure(detail)
  const d = (detail || '').toLowerCase()
  if (d.includes('arm controller') || d.includes('arm refuses') || d.includes('arm could not be recovered') || d.includes('arm is faulted')) return 'arm_fault'
  if (d.includes('AI judge') && (d.includes('not holding') || d.includes('no item'))) return 'item_not_held'
  if (d.includes('search exhausted') || d.includes('not found')) return 'search_exhausted'
  if (d.includes('reachability') || d.includes('plan_grasp failed') || d.includes('collision')) return 'reachability_failed'
  if (d.includes('no_valid_depth') || d.includes('no valid depth')) return 'no_valid_depth'
  if (d.includes('handover') && d.includes('failed')) return 'handover_failed'
  if (d.includes('user abort') || d.includes('user declined')) return 'user_cancelled'
  if (d.includes('gripper') && d.includes('fail')) return 'gripper_failed'
  if (d.includes('e_stop') || d.includes('emergency')) return 'e_stopped'
  if (d.includes('timeout')) return 'timeout'
  if (d.includes('keyboardinterrupt') || d.includes('keyboard interrupt') || d.includes('operator abort')) return 'operator_abort'
  if (d.includes('bridge') && d.includes('fault')) return 'bridge_fault'
  return 'unknown'
}

function classifyFailureFriendly(detail) {
  if (PROFILE.classifyFailureFriendly) return PROFILE.classifyFailureFriendly(detail)
  const map = {
    search_exhausted: 'Item not found',
    reachability_failed: 'Path blocked (collision)',
    no_valid_depth: 'Depth measurement failed',
    handover_failed: 'Handover path blocked',
    user_cancelled: 'User cancelled',
    gripper_failed: 'Grip failure',
    e_stopped: 'Emergency stop',
    timeout: 'Timeout',
    operator_abort: 'Operator aborted',
    bridge_fault: 'Hardware fault',
    arm_fault: 'Arm fault',
    item_not_held: 'Item not in the gripper',
    unknown: 'Unknown failure',
  }
  return map[classifyFailure(detail)] || 'Unknown failure'
}

// ── Phase grouping for order step log ───────────────────────────────────────

function groupEventsIntoPhases(rawSteps) {
  const grouped = []
  let current = null

  for (const step of rawSteps) {
    const phase = _compToPhase[step.component]
    if (!phase) {
      if (current) grouped.push(current)
      current = null
      continue
    }

    if (current && current.phase === phase.phase) {
      current.duration_seconds += step.duration_seconds || 0
      if (step.meta) Object.assign(current.meta, step.meta)
    } else {
      if (current) grouped.push(current)
      current = {
        phase: phase.phase,
        friendly_name: phase.friendly_name,
        components: [...phase.components],
        duration_seconds: step.duration_seconds || 0,
        meta: step.meta ? { ...step.meta } : {},
      }
    }
  }

  if (current) grouped.push(current)
  return grouped
}

// ── Order bookkeeping ────────────────────────────────────────────────────────

if (!fs.existsSync(ORDERS_DIR)) fs.mkdirSync(ORDERS_DIR, { recursive: true })

// orders.json is shared with the RAG server, which reads it at any moment. Two rules keep
// both sides honest: writes are atomic (temp file + rename), and a read that fails is
// retried and never mistaken for "no orders" — an empty read followed by a write would
// wipe the whole history.
let lastGoodOrders = []
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function readOrdersStrict() {
  if (!fs.existsSync(ORDERS_FILE)) return { orders: [], ok: true }
  let lastErr = null
  for (let i = 0; i < 5; i++) {
    try {
      const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'))
      lastGoodOrders = orders
      return { orders, ok: true }
    } catch (err) {
      lastErr = err
      sleepSync(50)
    }
  }
  console.error(`  orders.json unreadable after retries (${lastErr && lastErr.message}); using the last good copy (${lastGoodOrders.length} orders)`)
  return { orders: lastGoodOrders, ok: false }
}

function readOrders() {
  return readOrdersStrict().orders
}

function writeOrdersAtomic(orders) {
  const tmp = ORDERS_FILE + '.tmp'
  const body = JSON.stringify(orders, null, 2)
  fs.writeFileSync(tmp, body)
  for (let i = 0; i < 5; i++) {
    try { fs.renameSync(tmp, ORDERS_FILE); return } catch { sleepSync(40) }   // Windows: a reader may hold the file
  }
  fs.writeFileSync(ORDERS_FILE, body)
  try { fs.unlinkSync(tmp) } catch {}
}

function writeOrder(entry) {
  const { orders, ok } = readOrdersStrict()
  if (!ok) {
    console.error(`  NOT saving order ${entry && entry.id}: orders.json could not be read, and writing now would overwrite the history`)
    return
  }
  orders.push(entry)
  writeOrdersAtomic(orders)
  lastGoodOrders = orders
}

function nextOrderId() {
  const orders = readOrders()
  if (!orders.length) return 1
  return Math.max(...orders.map(o => o.id)) + 1
}

// ── Single-line parser (used by both file replay and live stream) ───────────

// Per-order facts from the log (where the item was, every grasp attempt, the robot's settings): saved as order.run_details
const runDetails = require('./src/robots/runDetails.cjs').create()
function announceRunDetails(evt) {
  const details = runDetails.snapshot()
  if (!details) return
  const msg = { type: 'run_details', ts: evt.ts, details }
  cycleHistory = cycleHistory.filter(e => e.type !== 'run_details')
  cycleHistory.push(msg)
  broadcast(msg)
}

const _parserState = { lastTimestamp: null, tzOffsetMs: null, criticPending: null, criticPhase: null }

// ── AI Judge ──────────────────────────────────────────────────────────────
// The critic is a separate service: an external camera and a vision-language model that judge the
// scene as a third person. It logs through loguru ("2026-10-21 17:11:56.022 | DEBUG | __main__:…"),
// in the machine's local time, while the orchestrator logs UTC. The offset between the two is
// learned from the first judge line that follows an orchestrator line (they are a whole number of
// half hours apart), so judge events land on the same clock as everything else.

const CRITIC_WHERE = /__main__:(_run_fast_check|_process_fast_checks|_update_state|_drain_state|_start_recording|_stop_recording|run|clear|__init__):\d+/

const CRITIC_QUESTIONS = {
  not_holding_target_item: 'Is the robot holding the item?',
}

function criticIso(date, time) {
  const local = Date.parse(`${date}T${time}Z`)
  const ref = Date.parse(_parserState.lastTimestamp)
  if (!Number.isFinite(local) || !Number.isFinite(ref)) return null
  const HALF_HOUR = 30 * 60 * 1000
  if (_parserState.tzOffsetMs == null || Math.abs(local - _parserState.tzOffsetMs - ref) > 10 * 60 * 1000) {
    _parserState.tzOffsetMs = Math.round((local - ref) / HALF_HOUR) * HALF_HOUR
  }
  return new Date(local - _parserState.tzOffsetMs).toISOString()
}

function parseCriticLine(line, tag) {
  const st = _parserState
  const lg = line.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3})\s*\|\s*(\w+)\s*\|\s*([^\s|]+)\s+-\s+(.*)$/)
  if (lg) {
    if (tag !== 'critic-service' && !CRITIC_WHERE.test(lg[4])) return undefined
    const level = lg[3]
    const msg = lg[5].trim()
    const ts = criticIso(lg[1], lg[2])
    if (!ts) return null
    const ev = (kind, fields) => ({ ts, type: 'critic', kind, origin: 'critic-service', ...fields })

    let m = msg.match(/^Fast check: `([^`]+)` with frames \[(.*?)\] and latency=([\d.]+)s/)
    if (m) {
      st.criticPending = { check: m[1], looks: (m[2].match(/'/g) || []).length / 2, latency: parseFloat(m[3]), ts, question: null }
      return null
    }
    m = msg.match(/^> Active check: `([^`]+)` for phase `([^`]+)` with ROI config: (\{.*\})/) || msg.match(/Active check: `([^`]+)` for phase `([^`]+)` with ROI config: (\{.*\})/)
    if (m) {
      const num = (k) => { const x = m[3].match(new RegExp(`'${k}': ([\\d.]+)`)); return x ? parseFloat(x[1]) : null }
      return ev('roi', { check: m[1], phase: m[2], roi: { x0: num('x0') ?? 0, x1: num('x1') ?? 1, y0: num('y0') ?? 0, y1: num('y1') ?? 1 }, detail: `watching ${m[1]} in ${m[2]}` })
    }
    m = msg.match(/^Received event: (\{.*\})$/)
    if (m) {
      const ph = m[1].match(/'phase': '([^']+)'/)
      if (!ph || ph[1] === st.criticPhase) return null
      st.criticPhase = ph[1]
      const target = m[1].match(/'target_item': '([^']+)'/)
      return ev('phase', { phase: ph[1], target: target ? target[1] : null, detail: ph[1] })
    }
    if (/\balert(ed|s)?\b/i.test(msg) && !/ready to send alerts/i.test(msg) && (/^(WARNING|ERROR|CRITICAL)$/.test(level) || /alert\s*[:=]|sending alert|sent alert|ALERT/.test(msg))) {
      return ev('alert', { text: msg.slice(0, 200), detail: msg.slice(0, 200) })
    }
    return null
  }

  // continuation lines of a fast check: the prompt dump, then the answer
  const p = st.criticPending
  if (p) {
    if (/^\[\{'role'/.test(line)) {
      const texts = [...line.matchAll(/'text':\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)].map(x => x[1] ?? x[2])
      const user = texts[texts.length - 1] || ''
      const q = user.match(/^[^?]*\?/)
      p.question = q ? q[0].trim() : null
      return null
    }
    const a = line.match(/^>\s*`(YES|NO)`/i)
    if (a) {
      st.criticPending = null
      return {
        ts: p.ts, type: 'critic', kind: 'check', origin: 'critic-service',
        check: p.check, question: p.question || CRITIC_QUESTIONS[p.check] || p.check.replace(/_/g, ' ') + '?',
        answer: a[1].toUpperCase(), latency: p.latency, looks: p.looks,
        detail: `${p.question || p.check} -> ${a[1].toUpperCase()} (${p.latency}s)`,
      }
    }
  }
  if (tag === 'critic-service') return null
  return undefined
}

// ── Arm controller faults ────────────────────────────────────────────────────
// These lines carry no timestamp and no SYSTEM/WORKFLOW marker. They explain why a handover
// ended in "gripper open failed: no result": the arm's controller had faulted.

const ARM_SAYS = {
  fault: 'The arm controller reported a system fault.',
  refuses: 'The arm refuses to move: its controller says motion is not possible. Someone has to check that the drives are powered and look for active alarms on the teach pendant.',
  ladder: 'Automatic recovery of the arm did not work; trying a full reconnect.',
  giveup: 'The arm could not be recovered automatically. It stays stopped until a person restarts it.',
  bringup: (a, b) => `Restarting the arm failed (attempt ${a} of ${b}).`,
  link: 'The link to the arm controller is down.',
}

function parseArmLine(line) {
  const r = parseArmLineRaw(line)
  if (!r) return r
  // the controller repeats itself in bursts (every retry logs the same few lines): say each thing once
  const st = _parserState
  if (st.armSeen?.ts !== r.ts) st.armSeen = { ts: r.ts, said: new Set() }
  if (st.armSeen.said.has(r.plain)) return null
  st.armSeen.said.add(r.plain)
  return r
}

function parseArmLineRaw(line) {
  const fault = (plain) => ({
    ts: _parserState.lastTimestamp, type: 'system_fault', source: 'arm', status: 'FAIL',
    severity: 'red', reason: 'arm_fault', plain, detail: line.slice(0, 240), origin: 'ARM:FAULT',
  })
  let m
  if (/FRC_SystemFault/.test(line)) return fault(ARM_SAYS.fault)
  if (/^FanucDriverExecutor: FAULTED/.test(line)) return fault(ARM_SAYS.refuses)
  if (/^FanucDriverExecutor: recovery FAILED/.test(line) || /^airo_fanuc: cold reconnect escalation failed/.test(line)) return fault(ARM_SAYS.giveup)
  if (/^airo_fanuc: recovery ladder/.test(line)) return fault(ARM_SAYS.ladder)
  if ((m = line.match(/^airo_fanuc: bring-up attempt (\d+)\/(\d+) failed/))) return fault(ARM_SAYS.bringup(m[1], m[2]))
  if (/^RMI: (session down|transport error)/.test(line) || /^airo_fanuc: best-effort FRC_Continue/.test(line)) return fault(ARM_SAYS.link)
  return undefined
}

function parseLine(rawLine) {
  // Aggregated logs tag each line with its process: "[orchestrator] 2026-…". Strip the tag (it has no
  // spaces inside the brackets, so the interactive "[cycle 1] …" / "[stage 1a …" lines are left alone).
  const tagMatch = rawLine.match(/^\[([\w-]+)\]\s+/)
  const tag = tagMatch ? tagMatch[1] : null
  const line = rawLine.replace(/\r$/, '').replace(/^\[[\w-]+\]\s+/, '')

  if (!line.trim()) return null

  // The AI Judge (critic service) and the arm controller write plain log lines, not
  // "ts | SYSTEM | …" lines. undefined = not one of theirs, null = theirs but nothing to report.
  const extra = parseCriticLine(line, tag)
  if (extra !== undefined) return extra
  const arm = parseArmLine(line)
  if (arm !== undefined) return arm
  if (line.startsWith('Traceback') || line.startsWith('  File ') || line.startsWith('    ')) return null
  if (line.startsWith('/home/') || line.startsWith('Loading checkpoint')
      || line.match(/^\d+%\|/) || line.startsWith('(viser)')
      || line.startsWith('╭') || line.startsWith('│') || line.startsWith('╰')) return null
  if (line.startsWith('WARNING:curobo')) {
    return { ts: _parserState.lastTimestamp, type: 'collision_warning', raw: line }
  }
  if (line.trim() === 'y' || line.trim() === 'N' || line.trim() === 't-shirt') return null
  if (line.match(/^\[stage \d+/) || line.match(/^\[search →/) || line.match(/^\[return-home →/)
      || line.match(/^\[goto →/) || line.match(/^\[cycle \d+\] (known|enter)/)
      || line.match(/execute\? \[y\/N\]/) || line.match(/\?\s*\[y\/N\]/)
      || line.match(/close gripper\?\s*\[/)
      || line.match(/^\[cycle \d+\] object>/) || line.match(/^\[cycle \d+\] '/)
      || line.match(/^  (import|warnings|torch)/)) return null
  if (line.startsWith('# connected to') || line.startsWith('uv run ')) return null

  // Handle lines where user input 'y' is concatenated with a timestamp
  if (line.match(/^y\d{4}-\d{2}-\d{2}T/)) {
    const cleaned = line.substring(1)
    const fixedMatch = cleaned.match(
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s*\|\s*(SYSTEM|WORKFLOW)\s*\|\s*([A-Z0-9_]+)(?::([A-Z0-9_]+))?\s*\|\s*(SUCCESS|FAIL|BEGIN|SKIP|FALLBACK)\s*\|\s*(.*)$/
    )
    if (fixedMatch) {
      _parserState.lastTimestamp = fixedMatch[1]
      const component = fixedMatch[3]
      const status = fixedMatch[5]
      const detail = fixedMatch[6].trim()
      if (fixedMatch[2] === 'WORKFLOW') {
        return { ts: _parserState.lastTimestamp, type: 'phase', component, action: fixedMatch[4] || null, status, detail }
      } else {
        return { ts: _parserState.lastTimestamp, type: 'system_event', component, action: fixedMatch[4] || null, status, text: detail }
      }
    }
    return null
  }

  // ── IMAGE lines: timestamp | IMAGE | image_id | description | base64_data
  const imageMatch = line.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s*\|\s*IMAGE\s*\|\s*(\S+)\s*\|\s*([^|]+?)\s*\|\s*(.+)$/
  )
  if (imageMatch) {
    _parserState.lastTimestamp = imageMatch[1]
    return {
      ts: imageMatch[1],
      type: 'image',
      imageId: imageMatch[2].trim(),
      description: imageMatch[3].trim(),
      camera: imageMatch[2].includes('zed') ? 'zed' : 'd415',
      base64: imageMatch[4].trim(),
    }
  }

  // ── Structured log: timestamp | LEVEL | COMPONENT[:ACTION] | STATUS | details
  const structured = line.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s*\|\s*(SYSTEM|WORKFLOW)\s*\|\s*([A-Z0-9_]+)(?::([A-Z0-9_]+))?\s*\|\s*(SUCCESS|FAIL|BEGIN|SKIP|FALLBACK)\s*\|\s*(.*)$/
  )
  if (structured) {
    _parserState.lastTimestamp = structured[1]
    const level = structured[2]
    const component = structured[3]
    const action = structured[4] || null
    const status = structured[5]
    const detail = structured[6].trim()

    // The bartender's cycles are "drink cycle N". A grocery relay that is pointed at the bar's log by
    // mistake must not start an order for them (and the bar's profile does the same for ours).
    if (component === 'CYCLE' && ROBOT_ID !== 'bar' && /^drink cycle/i.test(detail)) return null

    if (component === 'CYCLE' && status === 'BEGIN') {
      const m = detail.match(/cycle #?(\d+)/)
      return { ts: _parserState.lastTimestamp, type: 'cycle_start', cycleNum: m ? parseInt(m[1]) : 0, detail }
    }
    if (component === 'CYCLE' && (status === 'SUCCESS' || status === 'FAIL')) {
      return { ts: _parserState.lastTimestamp, type: 'cycle_end', outcome: status, detail }
    }

    if (component === 'PROMPT' && status === 'SUCCESS') {
      const objMatch = detail.match(/object='([^']+)'/)
      const gotoMatch = detail.match(/goto '([^']+)'/)
      const wheelMatch = detail.match(/wheel triggered:.*?grasp_prompt='([^']+)'/)
      if (objMatch) {
        return { ts: _parserState.lastTimestamp, type: 'object_selected', objectName: objMatch[1] }
      }
      if (wheelMatch) {
        return { ts: _parserState.lastTimestamp, type: 'object_selected', objectName: wheelMatch[1] }
      }
      if (gotoMatch) {
        return { ts: _parserState.lastTimestamp, type: 'system_event', text: `goto ${gotoMatch[1]}` }
      }
      return null
    }
    if (component === 'PROMPT' && status === 'BEGIN') {
      // Tag re-spin events explicitly so the dashboard can highlight them
      const respun = /re-?spun by operator/i.test(detail) || /wheel re-spun/i.test(detail)
      return { ts: _parserState.lastTimestamp, type: 'prompt_activity', status, detail, kind: respun ? 'respin' : 'watch' }
    }
    if (component === 'PROMPT' && status === 'SKIP') {
      return { ts: _parserState.lastTimestamp, type: 'prompt_activity', status, detail, kind: 'skip' }
    }

    if (component === 'IDLE') {
      // "wheel-spin event consumed" on IDLE = operator just spun the wheel.
      // Surface that as a distinct event so the dashboard can show it.
      if (status === 'SUCCESS' && /wheel[-_ ]spin/i.test(detail)) {
        return { ts: _parserState.lastTimestamp, type: 'wheel_spin', detail }
      }
      return { ts: _parserState.lastTimestamp, type: 'idle_tick', status, detail }
    }

    if (component === 'SEARCH_DETECT') {
      const wpMatch = detail.match(/waypoint '([^']+)'/)
      return {
        ts: _parserState.lastTimestamp, type: 'phase', component, action, status, detail,
        waypoint: wpMatch ? wpMatch[1] : null,
      }
    }

    if (component === 'GRIPPER') {
      const isOpen = action === 'OPEN'
      const ok = status === 'SUCCESS'
      return {
        ts: _parserState.lastTimestamp, type: 'gripper', success: ok,
        message: ok ? (isOpen ? 'Gripper opened' : 'Gripper closed') : (isOpen ? 'Gripper failed to open' : 'Gripper failed to close'),
        raw: detail,
      }
    }

    // The handover: did the robot find a person to hold the item out to? (EXECUTOR:PRESENT lines)
    if (component === 'EXECUTOR' && action === 'PRESENT') {
      const person = /no person seen|no recipient/i.test(detail) ? false
        : /presenting toward|presented toward|re-identified/i.test(detail) ? true : null
      if (person === null) return { ts: _parserState.lastTimestamp, type: 'system_event', component, action, status, text: detail }
      return { ts: _parserState.lastTimestamp, type: 'handover', kind: 'present', person, status, detail }
    }

    if (component === 'EXECUTOR' && action === 'TRAJECTORY') {
      return { ts: _parserState.lastTimestamp, type: 'system_event', text: detail }
    }

    if (component === 'EXECUTOR' && action === 'SHUTDOWN') {
      return { ts: _parserState.lastTimestamp, type: 'executor_shutdown', detail }
    }

    if (component === 'EXECUTOR' && action === 'FAULT_RECOVER' && status === 'FAIL') {
      return {
        ts: _parserState.lastTimestamp, type: 'system_fault', source: 'arm', status: 'FAIL', severity: 'red', reason: 'arm_fault',
        plain: ARM_SAYS.giveup, detail: detail.slice(0, 240), origin: 'EXECUTOR:FAULT_RECOVER',
      }
    }

    if (component === 'EXECUTOR' && action === 'FAULT') {
      return { ts: _parserState.lastTimestamp, type: 'system_fault', source: 'executor', status, detail }
    }

    // ── Calibration sub-events (SYSTEM | CALIBRATION:PROMPTS_LOADED etc.) ───
    if (component === 'CALIBRATION') {
      return { ts: _parserState.lastTimestamp, type: 'calibration', action, status, detail }
    }

    // ── Bridge events (FAULT, MOTION_POSSIBLE, RMI_LINK, etc.) ──────────────
    if (component === 'BRIDGE') {
      if (action === 'FAULT') {
        return { ts: _parserState.lastTimestamp, type: 'system_fault', source: 'bridge', status, detail }
      }
      if (action === 'MOTION_POSSIBLE' && status === 'SUCCESS') {
        return { ts: _parserState.lastTimestamp, type: 'fault_recovery', source: 'bridge', detail }
      }
      return { ts: _parserState.lastTimestamp, type: 'system_event', component, action, status, text: detail }
    }

    // ── Startup components (SAM3, MOLMO, VOXELS, etc.) ──────────────────────
    if (action === 'STARTUP') {
      return { ts: _parserState.lastTimestamp, type: 'calibration', action: `${component}_STARTUP`, status, detail }
    }

    if (level === 'WORKFLOW') {
      return { ts: _parserState.lastTimestamp, type: 'phase', component, action, status, detail }
    }

    return { ts: _parserState.lastTimestamp, type: 'system_event', component, action, status, text: detail }
  }

  // ── Loguru format: timestamp | LEVEL | module:func:line - message
  const loguru = line.match(
    /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s*\|\s*(\w+)\s+\|\s*([\w.:\-]+)\s*-\s*(.*)$/
  )
  if (loguru) {
    _parserState.lastTimestamp = _parserState.lastTimestamp || loguru[1]
    const logMessage = loguru[4].trim()

    if (logMessage.includes('Gripper result:')) {
      const m = logMessage.match(/success=(\w+), message=(.+)/)
      return { ts: _parserState.lastTimestamp, type: 'gripper', success: m?.[1] === 'True', message: m?.[2] || '', raw: logMessage }
    } else if (logMessage.includes('TrajectoryTarget envelope:')) {
      const dur = logMessage.match(/duration=([\d.]+)s/)
      const spd = logMessage.match(/speed_scale=([\d.]+)/)
      return { ts: _parserState.lastTimestamp, type: 'motion', duration: parseFloat(dur?.[1] || '0'), speedScale: parseFloat(spd?.[1] || '0.75'), raw: logMessage }
    } else if (logMessage.includes('robot status:') || logMessage.includes('robot_status:')) {
      return { ts: _parserState.lastTimestamp, type: 'robot_status', raw: logMessage }
    }
    return null
  }

  // ── [cycle N] object> name
  const objInput = line.match(/object>\s*(.+)$/)
  if (objInput) return null

  return null
}

// ── Batch file parser (wraps parseLine) ─────────────────────────────────────

// "critic: holding 'coffee mug' (no alert in 2.5s) → handover" is the orchestrator reporting what the
// AI Judge decided, so it also becomes a judge event next to the ordinary phase event.
function itemCheckVerdict(e) {
  const detail = e.detail || ''
  const out = { ts: e.ts, type: 'critic', kind: 'verdict', topic: 'holding', status: e.status, origin: 'ITEM_CHECK', detail, holding: null, item: null, quiet: null }
  const held = detail.match(/holding '([^']+)'/)
  const quiet = detail.match(/no alert in ([\d.]+)s/)
  if (held) out.item = held[1]
  if (quiet) out.quiet = parseFloat(quiet[1])
  if (e.status === 'SUCCESS') out.holding = true
  else if (e.status === 'FAIL') out.holding = false
  if (e.status === 'BEGIN') { const w = detail.match(/waypoint '([^']+)'/); out.waypoint = w ? w[1] : null }
  return out
}

function normalizeEvents(evt) {
  const events = PROFILE.normalize ? PROFILE.normalize(evt) : (evt ? [evt] : [])
  return events.flatMap(e => (e && e.type === 'phase' && e.component === 'ITEM_CHECK') ? [e, itemCheckVerdict(e)] : [e])
}

function parseLog(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  const events = []
  _parserState.lastTimestamp = null

  for (const rawLine of raw) {
    for (const evt of normalizeEvents(parseLine(rawLine))) events.push(evt)
  }

  return events
}

// ── Timestamp math ───────────────────────────────────────────────────────────

function tsToMs(tsStr) {
  if (!tsStr) return null
  // ISO format: 2026-05-14T15:01:43.788Z
  const isoMatch = tsStr.match(/T(\d{2}):(\d{2}):(\d{2})\.(\d{3})/)
  if (isoMatch) {
    return (parseInt(isoMatch[1]) * 3600 + parseInt(isoMatch[2]) * 60 + parseInt(isoMatch[3])) * 1000 + parseInt(isoMatch[4])
  }
  // Fallback: HH:MM:SS.mmm
  const m = tsStr.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/)
  if (!m) return null
  return (parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3])) * 1000 + parseInt(m[4])
}

function computeDelays(events) {
  const delays = [0]
  for (let i = 1; i < events.length; i++) {
    const prev = tsToMs(events[i - 1].ts)
    const curr = tsToMs(events[i].ts)
    if (prev !== null && curr !== null && curr > prev) {
      let d = Math.min(curr - prev, MAX_EVENT_DELAY)
      // REPLAY_SKIP_IDLE=1: the robot idling between orders ("idle behaviour" ticks, minutes of them) plays in
      // a blink; the time inside an order keeps the log's own pace
      if (SKIP_IDLE && (events[i].type === 'idle_tick' || events[i - 1].type === 'idle_tick')) d = Math.min(d, 300)
      delays.push(d / REPLAY_SPEED)
    } else {
      delays.push(50 / REPLAY_SPEED)
    }
  }
  return delays
}

// ── Parse once at startup ────────────────────────────────────────────────────

const allEvents = parseLog(LOG_FILE)
const delays = computeDelays(allEvents)

console.log(`Parsed ${allEvents.length} events from ${path.basename(LOG_FILE)}`)
console.log(`Replay speed: ${REPLAY_SPEED}x`)

// ── Global replay state ─────────────────────────────────────────────────────

let cycleHistory = []
let currentEventIndex = 0
let loopCount = 0
let globalTimeout = null
let heartbeatTimer = null
// The next order id we'll hand out. Only advances once a real order has been
// written, so skipped/anomaly cycles don't leave gaps and the live "Order #"
// always matches what eventually lands in orders.json.
let nextOrderIdToAssign = nextOrderId()
let cycleWritten = false           // guards against double-writes within a cycle
let currentItem = null
let cycleStartTime = null
let rawStepLog = []
let stepStart = null
let stepComponent = null
let stepMeta = {}
let cycleFailures = []
let retryCount = 0
let waypointsSearched = []
let waypointFoundAt = null
let graspWidth = null
let collisionWarnings = 0
let currentCycleIsAnomaly = false
let cycleImages = []           // { imageId, camera, description, failComponent, filePath }
let lastFailComponent = null   // tracks which component just failed (for associating images)

const IMAGES_DIR = path.join(ORDERS_DIR, 'images')
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true })

function detectImageExtFromBuffer(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return '.png'
  if (buf[0] === 0xFF && buf[1] === 0xD8) return '.jpg'
  if (buf[0] === 0x42 && buf[1] === 0x4D) return '.bmp'
  return '.jpg' // default fallback
}

function findExistingImage(imageId) {
  for (const ext of ['.jpg', '.jpeg', '.bmp', '.png']) {
    const p = path.join(IMAGES_DIR, `${imageId}${ext}`)
    if (fs.existsSync(p)) return p
  }
  return null
}

function looksLikeImage(buf) {
  return buf.length > 200 && (
    (buf[0] === 0xFF && buf[1] === 0xD8) ||
    (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) ||
    (buf[0] === 0x42 && buf[1] === 0x4D))
}

// A replay of a saved log has no picture data ("<base64 omitted …>", "<jpeg 80 kB>"). The picture is then taken
// from the pictures the robot saved earlier in the repository's own data/images folder if it is there, and
// otherwise a sample picture stands in for it, so a replay still shows what the dashboard does with pictures.
function replacementImage(imageId) {
  const shared = path.join(__dirname, 'data', 'images')
  if (path.resolve(shared) !== path.resolve(IMAGES_DIR)) {
    for (const ext of ['.jpg', '.jpeg', '.png', '.bmp']) {
      const p = path.join(shared, `${imageId}${ext}`)
      if (fs.existsSync(p)) return { buf: fs.readFileSync(p), ext }
    }
  }
  const sample = path.join(__dirname, 'scripts', 'fixtures', `sample_failure_${/zed/i.test(imageId) ? 'zed' : 'd415'}.jpg`)
  return fs.existsSync(sample) ? { buf: fs.readFileSync(sample), ext: '.jpg' } : null
}

function saveImage(imageId, base64) {
  // Never overwrite an existing image (allows manual placement of real photos)
  const existing = findExistingImage(imageId)
  if (existing) return existing

  let buf = Buffer.from(base64 || '', 'base64')
  let ext = detectImageExtFromBuffer(buf)
  if (!looksLikeImage(buf)) {
    const r = replacementImage(imageId)
    if (!r) return null
    buf = r.buf
    ext = r.ext
  }
  const filePath = path.join(IMAGES_DIR, `${imageId}${ext}`)
  try {
    fs.writeFileSync(filePath, buf)
    return filePath
  } catch (e) {
    console.log(`  Failed to save image ${imageId}: ${e.message}`)
    return null
  }
}

// ── Keeping pictures only as long as wanted ─────────────────────────────────────
// IMAGE_RETENTION_HOURS=<n> deletes failure pictures (and their context files) older than n hours, when the
// relay starts and then every hour. Unset or 0 keeps them.
const IMAGE_RETENTION_HOURS = parseFloat(process.env.IMAGE_RETENTION_HOURS || '0')
function purgeOldImages() {
  if (!(IMAGE_RETENTION_HOURS > 0)) return
  const cutoff = Date.now() - IMAGE_RETENTION_HOURS * 3600 * 1000
  let n = 0
  try {
    for (const f of fs.readdirSync(IMAGES_DIR)) {
      const p = path.join(IMAGES_DIR, f)
      try { if (fs.statSync(p).isFile() && fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); n++ } } catch {}
    }
  } catch {}
  if (n) console.log(`  Deleted ${n} picture file(s) older than ${IMAGE_RETENTION_HOURS} h`)
}
purgeOldImages()
if (IMAGE_RETENTION_HOURS > 0) setInterval(purgeOldImages, 3600 * 1000).unref()

// ── Recent-event ring buffer (used as context for image analysis) ──────────
// Every event we broadcast gets stamped with a *server* (UI-clock) timestamp
// and appended here. Image context comes from the events surrounding the
// image's server-side arrival time, NOT the robot's own timestamps (which
// can drift hours from real time).
const SERVER_EVENT_LOG_LIMIT = 800
const serverEventLog = []
function recordServerEvent(evt) {
  if (!evt) return
  // Skip super-frequent heartbeats — they add no diagnostic context
  if (evt.type === 'heartbeat' || evt.type === 'idle_tick') return
  serverEventLog.push({
    serverTs: new Date().toISOString(),
    type: evt.type,
    component: evt.component || null,
    action: evt.action || null,
    status: evt.status || null,
    detail: evt.detail || evt.text || evt.message || null,
    cycleNum: evt.cycleNum || null,
  })
  if (serverEventLog.length > SERVER_EVENT_LOG_LIMIT) {
    serverEventLog.splice(0, serverEventLog.length - SERVER_EVENT_LOG_LIMIT)
  }
}

// Write a context snapshot alongside the image: events from the 30 s before
// and 5 s after the image landed. The vision endpoint can then read this file
// to ground its interpretation in what was actually happening.
const IMAGE_CONTEXT_WINDOW_BEFORE_MS = 30_000
const IMAGE_CONTEXT_WINDOW_AFTER_MS = 5_000

// Compute a short human-readable caption from the surrounding event log.
// Picks out the most recent phase / gripper / fault event before the image
// so the UI can show "While analyzing the grasp · gripper closed" without
// any LLM call.
function composeImageCaption(events) {
  if (!events || events.length === 0) return ''
  const PHASE_LABELS = {
    SCENE_SCAN: 'scanning the scene',
    SEARCH_DETECT: 'searching for the item',
    ANCHOR_SELECT: 'selecting a target',
    CLOSEUP_MOVE: 'moving closer',
    CLOSEUP_MOLMO: 'analyzing the grasp',
    CLOSEUP_REFINE: 'analyzing the grasp',
    CLOSEUP_LIFT: 'measuring distance',
    SYNTHESISE: 'planning the grasp',
    VISUALISE: 'previewing the grasp',
    EXECUTE_GRASP: 'picking up',
    CLOSEUP_RETRY: 'retrying the grasp',
    ITEM_CHECK: 'checking the grip',
    HANDOVER_TRANSIT: 'bringing it over',
    HANDOVER_MOVE: 'moving to handover',
    HANDOVER_RELEASE: 'handing over',
    HANDOVER_RETURN: 'returning',
    RETURN_HOME: 'returning home',
  }
  let lastPhase = null
  let lastGripper = null
  let lastFault = null
  for (const e of events) {
    if (e.type === 'phase' && e.component && PHASE_LABELS[e.component]) {
      lastPhase = { label: PHASE_LABELS[e.component], status: e.status }
    }
    if (e.type === 'gripper' || e.component === 'GRIPPER') {
      const isOpen = /open/i.test(e.action || e.detail || '')
      lastGripper = isOpen ? 'gripper open' : 'gripper closed'
    }
    if (e.type === 'system_fault' && e.status === 'FAIL') {
      lastFault = (e.detail || '').slice(0, 60)
    }
  }
  const parts = []
  if (lastPhase) {
    const verb = lastPhase.status === 'FAIL' ? 'failed while' : 'while'
    parts.push(`${verb} ${lastPhase.label}`)
  }
  if (lastGripper) parts.push(lastGripper)
  if (lastFault) parts.push(`hardware fault: ${lastFault}`)
  if (parts.length === 0) return ''
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
  return [first, ...parts.slice(1)].join(' · ')
}

function saveImageContext(imageId, serverTs) {
  try {
    const t = new Date(serverTs).getTime()
    const from = t - IMAGE_CONTEXT_WINDOW_BEFORE_MS
    const to = t + IMAGE_CONTEXT_WINDOW_AFTER_MS
    const events = serverEventLog.filter(e => {
      const et = new Date(e.serverTs).getTime()
      return et >= from && et <= to
    })
    const caption = composeImageCaption(events)
    const ctxPath = path.join(IMAGES_DIR, `${imageId}.context.json`)
    fs.writeFileSync(ctxPath, JSON.stringify({
      imageId,
      imageReceivedAt: serverTs,
      windowFrom: new Date(from).toISOString(),
      windowTo: new Date(to).toISOString(),
      caption,
      events,
    }, null, 2))
    return caption
  } catch (e) {
    console.log(`  Failed to save image context for ${imageId}: ${e.message}`)
    return ''
  }
}

function broadcast(data) {
  const msg = JSON.stringify(data)
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg)
  }
}

function sendHeartbeat() {
  broadcast({ type: 'heartbeat', ts: new Date().toISOString() })
}

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL / REPLAY_SPEED)
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
}

function saveReplayState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      eventIndex: currentEventIndex,
      loopCount,
      nextOrderIdToAssign,
      currentItem,
      savedAt: new Date().toISOString(),
    }))
  } catch {}
}

// ── Flush a step into the raw log ───────────────────────────────────────────

function flushStep() {
  if (stepComponent && stepStart) {
    rawStepLog.push({
      component: stepComponent,
      name: stepComponent,
      duration_seconds: Math.round((Date.now() - stepStart) / 1000),
      meta: { ...stepMeta },
    })
  }
}

// ── AI Judge bookkeeping ──────────────────────────────────────────────────
// What the judge said during the cycle, kept for the saved order (order.critic).

let cycleCritic = null

function criticTrack(evt) {
  if (!cycleStartTime || cycleWritten) return
  const c = cycleCritic || (cycleCritic = {
    topic: null, item: null, checks: 0, yes: 0, no: 0, latency_ms: 0, question: null, roi: null,
    phases: [], alerts: [], verdict: null, quiet_seconds: null, text: null, first_ts: evt.ts || null, last_ts: evt.ts || null,
  })
  c.last_ts = evt.ts || c.last_ts
  if (evt.kind === 'phase') {
    if (evt.target) c.item = evt.target
    if (evt.phase && !c.phases.includes(evt.phase)) c.phases.push(evt.phase)
  } else if (evt.kind === 'roi') {
    c.roi = evt.roi
  } else if (evt.kind === 'check') {
    c.checks++
    if (evt.answer === 'YES') c.yes++
    else c.no++
    c.latency_ms += Math.round((evt.latency || 0) * 1000)
    c.question = evt.question || c.question
    c.topic = c.topic || 'holding'
  } else if (evt.kind === 'alert') {
    c.alerts.push(evt.text)
  } else if (evt.kind === 'verdict' && evt.status !== 'BEGIN') {
    c.topic = evt.topic || c.topic
    if (evt.item) c.item = evt.item
    if (evt.quiet != null) c.quiet_seconds = evt.quiet
    if (evt.verdict) c.verdict = evt.verdict
    else if (evt.holding === true) c.verdict = 'holding'
    else if (evt.holding === false) c.verdict = 'not_holding'
    c.text = evt.text || evt.detail || c.text
    if (evt.bottle != null) c.bottle = evt.bottle
  }
}

function criticSummary() {
  if (!cycleCritic) return null
  const c = cycleCritic
  return { ...c, avg_latency_ms: c.checks ? Math.round(c.latency_ms / c.checks) : null }
}

// Judge events are tracked for the order and passed on to the dashboard; they are part of the
// cycle's catch-up history so a page opened mid-cycle still shows what the judge has said.
// The picture itself stays on disk (GET /api/images/<id>); the dashboard is only told that it exists,
// which step it belongs to and a short caption.
function failureImageEvent(evt, component, caption) {
  return {
    type: 'failure_image', ts: evt.ts, imageId: evt.imageId, camera: evt.camera,
    description: evt.description, component: component || null, caption: caption || '',
  }
}

function handleCriticEvent(evt) {
  criticTrack(evt)
  cycleHistory.push(evt)
  broadcast(evt)
}

// How the handover went, from the cycle's own events: was a person found to hold the item out to,
// and why did the gripper open ("release_reason=tug": the customer pulled the item out).
function handoverSummary() {
  let person = null
  let reason = null
  for (const e of cycleHistory) {
    if (e.type === 'handover' && e.person !== null && e.person !== undefined) person = e.person
    if (e.type === 'phase' && e.component === 'HANDOVER_RELEASE' && e.status === 'SUCCESS') {
      const m = (e.detail || '').match(/release_reason=(\w+)/)
      if (m) reason = m[1]
    }
  }
  return person === null && reason === null ? null : { person_seen: person, release_reason: reason }
}

// ── Write an order record ───────────────────────────────────────────────────

function writeCompletedOrder(outcome, failDetail) {
  if (cycleWritten) return   // refuse a second write for the same cycle
  flushStep()
  const orderId = nextOrderIdToAssign
  const cycleSucceeded = outcome !== 'FAIL'
  const hasCritical = cycleFailures.some(f => f.level === 'red')
  // Orange-level failures (retries, search misses at one waypoint, bridge
  // faults) are only considered a "warning" when the cycle ultimately failed.
  // If the cycle succeeded, those recoveries worked and don't deserve flagging.
  const hasUnrecoveredOrange = !cycleSucceeded && cycleFailures.some(f => f.level === 'orange')

  let status
  if (outcome === 'FAIL') status = 'failed'
  else if (hasCritical) status = 'warning'   // red recovered but worth noting
  else status = 'success'                    // retries/oranges that recovered → success

  // Resolve a failure's phase, preferring the explicit phase recorded on the
  // failure object (set when GRIPPER / BRIDGE etc. fail), falling back to the
  // component → phase mapping.
  const phaseOfFailure = (f) => f?.phase || _compToPhase[f?.component]?.phase || null

  let failure = null
  if (status === 'failed') {
    const f = cycleFailures.find(f => f.level === 'red') || { message: failDetail || 'Unknown failure' }
    failure = {
      reason: f.reason || classifyFailure(f.message || failDetail),
      detail: f.message || failDetail,
      at_phase: phaseOfFailure(f),
    }
  } else if (status === 'warning') {
    const f = cycleFailures.find(f => f.level === 'red')
    if (f) {
      failure = {
        reason: f.reason || classifyFailure(f.message),
        detail: f.message,
        at_phase: phaseOfFailure(f) || 'analyzing',
      }
    }
  }

  const steps = groupEventsIntoPhases(rawStepLog)
  const handover = handoverSummary()
  const run_details = runDetails.snapshot()

  // Annotate each step with failure status for history UI coloring
  for (const step of steps) {
    const phaseFailures = cycleFailures.filter(f => phaseOfFailure(f) === step.phase)
    const hasRed = phaseFailures.some(f => f.level === 'red')
    // Treat orange failures as warnings only when the cycle ultimately failed.
    // A successful cycle means every retry/recovery in this step worked → 'ok'.
    const hasOrange = !cycleSucceeded && phaseFailures.some(f => f.level === 'orange')
    if (hasRed) {
      // If the cycle succeeded despite this red, downgrade the step to a warning
      // (something serious happened but the robot recovered).
      step.status = cycleSucceeded ? 'warning' : 'failed'
      step.failure_detail = classifyFailureFriendly(phaseFailures.find(f => f.level === 'red').message)
    } else if (hasOrange) {
      step.status = 'warning'
      step.failure_detail = phaseFailures.find(f => f.level === 'orange').message
    } else {
      step.status = 'ok'
    }

    // Attach failure images to the step they belong to
    const stepImages = cycleImages
      .filter(img => {
        const imgPhase = _compToPhase[img.failComponent]
        return imgPhase && imgPhase.phase === step.phase
      })
      .map(img => ({
        imageId: img.imageId,
        camera: img.camera,
        description: img.description,
        // Short caption synthesised from log lines around the moment the
        // image was captured — used by the UI to label each image with what
        // was happening, no LLM needed.
        log_caption: img.logCaption || '',
        captured_at: img.serverReceivedAt || null,
      }))
    if (stepImages.length > 0) step.images = stepImages
  }

  const robotSeconds = steps.reduce((s, p) => s + p.duration_seconds, 0)
  const totalSeconds = Math.round((Date.now() - cycleStartTime) / 1000)
  const startedAt = new Date(cycleStartTime).toISOString()
  const d = new Date(cycleStartTime)
  const timestamp = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

  writeOrder({
    id: orderId,
    order_number: String(orderId),
    status,
    failure,
    item: currentItem || 'unknown',
    robot_id: PROFILE.robotId || 'ROBI',
    robot: ROBOT_ID,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    total_seconds: totalSeconds,
    robot_seconds: robotSeconds,
    human_wait_seconds: Math.max(0, totalSeconds - robotSeconds),
    retries: retryCount,
    waypoints_searched: [...waypointsSearched],
    waypoint_found_at: waypointFoundAt,
    grasp_width_mm: graspWidth,
    collision_warnings: collisionWarnings,
    steps,
    timestamp,
    rating: status === 'success' ? 5 : status === 'warning' ? 3 : 1,
    ...(criticSummary() ? { critic: criticSummary() } : {}),
    ...(handover ? { handover } : {}),
    ...(run_details ? { run_details } : {}),
    ...(PROFILE.orderExtras ? PROFILE.orderExtras() : {}),
  })
  cycleWritten = true
  nextOrderIdToAssign = orderId + 1
  console.log(`  Order #${orderId} (${currentItem}) [${status}] written to orders.json`)
}

// ── Live robot connection ───────────────────────────────────────────────────

let robotWs = null
let liveAttempts = 0
let lastIdleBroadcast = 0

function broadcastSourceMode() {
  broadcast({ type: 'source_mode', mode: sourceMode, robot: ROBOT_ID })
}

function processLiveEvent(evt) {
  if (!evt) return
  if (PROFILE.observe) PROFILE.observe(evt)
  if (runDetails.observe(evt)) announceRunDetails(evt)

  // ── Cycle bookkeeping (same logic as replay)
  if (evt.type === 'cycle_start') {
    // If the previous cycle never got a chance to write (no CYCLE end +
    // no executor shutdown), close it out as failed so we don't end up
    // with two cycles fighting over one order id.
    if (cycleStartTime && currentItem && !currentCycleIsAnomaly && !cycleWritten) {
      writeCompletedOrder('FAIL', 'Cycle abandoned (no terminator before new cycle)')
    }
    // Don't advance the order id here — it advances on a successful write.
    // That way anomaly cycles (invalid input) don't burn a number.
    cycleWritten = false
    currentItem = null
    currentCycleIsAnomaly = false
    cycleStartTime = Date.now()
    rawStepLog = []
    stepStart = Date.now()
    stepComponent = null
    stepMeta = {}
    cycleFailures = []
    retryCount = 0
    waypointsSearched = []
    waypointFoundAt = null
    graspWidth = null
    collisionWarnings = 0
    cycleImages = []
    lastFailComponent = null
    cycleHistory = []
    cycleCritic = null
  }

  if (evt.type === 'object_selected') {
    currentItem = evt.objectName
    if (!isValidItem(evt.objectName)) {
      currentCycleIsAnomaly = true
      console.log(`  Anomaly input: '${evt.objectName}' — skipping cycle`)
    }
  }

  // The AI Judge's events (live)
  if (evt.type === 'critic') {
    handleCriticEvent(evt)
    startHeartbeat()
    return
  }

  // Stamp the event with server (UI-clock) time and append to the ring buffer
  // so subsequent images get a properly synced context window.
  recordServerEvent(evt)

  // Save failure images to disk and associate with the preceding failure
  if (evt.type === 'image') {
    const filePath = saveImage(evt.imageId, evt.base64)
    if (filePath) {
      const serverReceivedAt = new Date().toISOString()
      const logCaption = saveImageContext(evt.imageId, serverReceivedAt) || ''
      cycleImages.push({
        imageId: evt.imageId,
        camera: evt.camera,
        description: evt.description,
        failComponent: lastFailComponent,
        ts: evt.ts,                       // robot-side timestamp (possibly drifting)
        serverReceivedAt,                 // UI-clock timestamp (authoritative)
        logCaption,                       // brief caption built from surrounding logs
      })
      console.log(`  Image saved: ${evt.imageId} (${evt.camera}) → ${lastFailComponent || 'no failure context'} [+context]`)
      const ref = failureImageEvent(evt, lastFailComponent, logCaption)
      cycleHistory.push(ref)
      broadcast(ref)
    }
    return
  }

  if (evt.type === 'phase') {
    const currentPhase = _compToPhase[evt.component]
    const prevPhase = _compToPhase[stepComponent]
    if (stepComponent && currentPhase !== prevPhase) {
      flushStep()
      stepStart = Date.now()
      stepComponent = evt.component
      stepMeta = {}
    } else if (!stepComponent) {
      stepStart = Date.now()
      stepComponent = evt.component
      stepMeta = {}
    }

    if (evt.component === 'SEARCH_DETECT' && evt.waypoint) {
      if (!waypointsSearched.includes(evt.waypoint)) waypointsSearched.push(evt.waypoint)
      if (evt.status === 'SUCCESS') waypointFoundAt = evt.waypoint
    }

    if (evt.component === 'CLOSEUP_RETRY' && evt.status === 'BEGIN') {
      retryCount++
      cycleFailures.push({ level: 'orange', message: evt.detail || 'Grasp retry', component: evt.component })
    }

    if (evt.component === 'SYNTHESISE' && evt.status === 'SUCCESS') {
      const wm = evt.detail?.match(/width=([\d.]+) mm/)
      if (wm) graspWidth = parseFloat(wm[1])
    }

    if (evt.status === 'FAIL') {
      lastFailComponent = evt.component
      const d = evt.detail || ''
      const fc = PROFILE.failureClass ? PROFILE.failureClass(evt) : null
      const isCritical = fc ? fc === 'red' : (evt.component === 'EXECUTE_GRASP' || evt.component === 'HANDOVER_MOVE'
        || evt.component === 'CLOSEUP_LIFT'
        || d.includes('search exhausted') || d.includes('no_valid_depth') || d.includes('no valid depth')
        || d.includes('handover failed'))
      if (isCritical) {
        cycleFailures.push({ level: 'red', message: (PROFILE.failureMessage ? PROFILE.failureMessage(evt) : evt.detail) || `${evt.component} failed`, component: evt.component })
      } else if (fc === 'orange') {
        cycleFailures.push({ level: 'orange', message: PROFILE.failureMessage ? PROFILE.failureMessage(evt) : (evt.detail || `${evt.component} failed`), component: evt.component })
      } else if (evt.component === 'SEARCH_DETECT') {
        cycleFailures.push({ level: 'orange', message: `No detections at ${evt.waypoint || 'waypoint'}`, component: evt.component })
      } else if (evt.component === 'ITEM_CHECK') {
        cycleFailures.push({ level: 'orange', message: 'AI Judge: not holding the item', component: evt.component, reason: 'item_not_held' })
      }
    }

    if (evt.component === 'ANCHOR_SELECT' && evt.status === 'SUCCESS') {
      const m = evt.detail?.match(/selected=#1\(d=([\d.]+)cm,score=([\d.]+)\)/)
      if (m) { stepMeta.anchor_distance_cm = parseFloat(m[1]); stepMeta.anchor_score = parseFloat(m[2]) }
    }
    if (evt.component === 'CLOSEUP_REFINE' && evt.status === 'SUCCESS') {
      const m = evt.detail?.match(/score=([\d.]+) area=(\d+)px/)
      if (m) { stepMeta.refine_score = parseFloat(m[1]); stepMeta.refine_area_px = parseInt(m[2]) }
    }
    if (evt.component === 'CLOSEUP_LIFT' && evt.status === 'SUCCESS') {
      const m = evt.detail?.match(/depth_med=([\d.]+)/)
      if (m) stepMeta.depth_m = parseFloat(m[1])
    }
    if (PROFILE.meta) Object.assign(stepMeta, PROFILE.meta(evt))
  }

  if (evt.type === 'collision_warning') { collisionWarnings++; return }
  if (evt.type === 'gripper' && !evt.success) {
    // Attribute the gripper failure to whichever pipeline phase is active
    // right now (CLOSE → grasping, OPEN → handing_over usually). This lets
    // the order's step-by-step list colour the right step yellow/red even
    // though GRIPPER itself isn't in the PHASES array.
    const activePhase = _compToPhase[stepComponent]?.phase || null
    cycleFailures.push({
      level: 'red',
      message: evt.message || 'Gripper failure',
      component: 'GRIPPER',
      phase: activePhase,
    })
  }
  if (evt.type === 'motion' && stepComponent) { stepMeta.trajectory_duration = evt.duration }

  if (evt.type === 'cycle_end' && cycleStartTime && currentItem && !currentCycleIsAnomaly) {
    writeCompletedOrder(evt.outcome, evt.detail)
  }

  // Executor shutdown without cycle_end → treat as aborted cycle
  if (evt.type === 'executor_shutdown' && cycleStartTime && currentItem && !currentCycleIsAnomaly) {
    writeCompletedOrder('FAIL', 'Pipeline aborted (operator interrupt)')
    cycleStartTime = null
  }

  // ── Idle ticks: throttle to max one broadcast per 5s ──────────────────────
  if (evt.type === 'idle_tick') {
    const now = Date.now()
    if (now - lastIdleBroadcast > 5000) {
      lastIdleBroadcast = now
      broadcast({ type: 'system_state', state: 'idle', ts: evt.ts, detail: evt.detail })
    }
    startHeartbeat()
    return
  }

  // ── Calibration: broadcast so frontend can show startup progress ──────────
  if (evt.type === 'calibration') {
    broadcast(evt)
    startHeartbeat()
    return
  }

  // ── Prompt activity: broadcast wheel watching / re-spins ──────────────────
  if (evt.type === 'prompt_activity') {
    broadcast(evt)
    startHeartbeat()
    return
  }

  // ── System faults (bridge, executor): track + broadcast ───────────────────
  if (evt.type === 'system_fault') {
    if (evt.status === 'FAIL') {
      const activePhase = _compToPhase[stepComponent]?.phase || null
      cycleFailures.push({
        level: evt.severity === 'red' ? 'red' : 'orange',
        message: evt.plain || evt.detail || `${evt.source} fault`,
        component: evt.source?.toUpperCase() || 'BRIDGE',
        phase: activePhase,
        ...(evt.reason ? { reason: evt.reason } : {}),
      })
    }
    if (evt.severity === 'red') cycleHistory.push(evt)
    broadcast(evt)
    startHeartbeat()
    return
  }

  // ── Fault recovery: broadcast so frontend clears warning ──────────────────
  if (evt.type === 'fault_recovery') {
    broadcast(evt)
    startHeartbeat()
    return
  }

  // ── Wheel spin: ephemeral, do not persist in catch-up history ─────────────
  if (evt.type === 'wheel_spin') {
    broadcast(evt)
    startHeartbeat()
    return
  }

  if (evt.type === 'system_event') return

  const payload = { ...evt }
  if (payload.type === 'cycle_start') {
    payload.cycleNum = nextOrderIdToAssign
  }

  cycleHistory.push(payload)
  broadcast(payload)
  startHeartbeat()
}

// ── Raw robot log ────────────────────────────────────────────────────────────
// Everything the robot sends over the socket is also saved as-is, one file per day
// (data/logs/robot-YYYY-MM-DD.log, or RAW_LOG_DIR), so a run can be inspected or replayed
// later (REPLAY_LOG=<file>) exactly as the robot reported it. Only live connections are
// recorded — never a static replay. The one change: IMAGE lines carry a base64 picture
// that is already saved under data/images, so that payload is replaced by its size.
// Nothing else is written: connects and disconnects go to the console, not into the log.
const RAW_LOG_DIR = process.env.RAW_LOG_DIR || path.join(ORDERS_DIR, 'logs')
let rawLogStream = null
let rawLogDay = null

function rawLogDayStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function rawLogWrite(text) {
  try {
    const day = rawLogDayStr()
    if (!rawLogStream || rawLogDay !== day) {
      if (rawLogStream) rawLogStream.end()
      fs.mkdirSync(RAW_LOG_DIR, { recursive: true })
      rawLogStream = fs.createWriteStream(path.join(RAW_LOG_DIR, `robot-${ROBOT_ID === ROBOTS.default ? "" : ROBOT_ID + "-"}${day}.log`), { flags: 'a' })
      rawLogStream.on('error', (err) => { console.error(`  raw log error: ${err.message}`); rawLogStream = null })
      rawLogDay = day
    }
    rawLogStream.write(text.endsWith('\n') ? text : text + '\n')
  } catch (err) {
    console.error(`  raw log error: ${err.message}`)   // never let logging break the relay
  }
}

// IMAGE lines: "<ts> | IMAGE | <id> | <description> | <base64>" (with or without a "[process] " prefix)
const IMAGE_LINE = /^(.*?\|\s*IMAGE\s*\|[^|]*\|[^|]*\|\s*)(\S{200,})\s*$/

function rawLogLine(line) {
  const m = line.match(IMAGE_LINE)
  rawLogWrite(m ? `${m[1]}<base64 omitted, ${m[2].length} chars; image saved under data/images>` : line)
}

// A robot that loses power or Wi-Fi never sends a close frame. Ping it; if nothing (no log line, no
// pong) arrives for KEEPALIVE_TIMEOUT, drop the socket so the normal reconnect takes over.
const KEEPALIVE_INTERVAL = 20_000
const KEEPALIVE_TIMEOUT = 60_000
let lastRobotActivity = Date.now()
let robotKeepAlive = null

function startRobotKeepAlive(sock) {
  lastRobotActivity = Date.now()
  if (robotKeepAlive) clearInterval(robotKeepAlive)
  robotKeepAlive = setInterval(() => {
    if (sock.readyState !== WebSocket.OPEN) return
    if (Date.now() - lastRobotActivity > KEEPALIVE_TIMEOUT) {
      console.log(`  No data or pong from the robot for ${KEEPALIVE_TIMEOUT / 1000}s — dropping the connection`)
      try { sock.terminate() } catch {}
      return
    }
    try { sock.ping() } catch {}
  }, KEEPALIVE_INTERVAL)
}

function stopRobotKeepAlive() {
  if (robotKeepAlive) { clearInterval(robotKeepAlive); robotKeepAlive = null }
}

function connectToRobot() {
  if (!ROBOT_WS) return

  liveAttempts++
  console.log(`  Connecting to robot at ${ROBOT_WS} (attempt ${liveAttempts})…`)

  try {
    robotWs = new WebSocket(ROBOT_WS, { handshakeTimeout: 5000 })
  } catch (err) {
    console.log(`  Failed to create WebSocket: ${err.message}`)
    handleRobotDisconnect()
    return
  }

  robotWs.on('open', () => {
    liveAttempts = 0
    stopStaticReplay()
    stopRobotProbe()
    if (robotReconnectTimer) { clearTimeout(robotReconnectTimer); robotReconnectTimer = null }
    sourceMode = 'live'
    console.log(`  Connected to robot at ${ROBOT_WS}`)
    broadcastSourceMode()
    _parserState.lastTimestamp = null
    startRobotKeepAlive(robotWs)
  })

  robotWs.on('message', (data) => {
    lastRobotActivity = Date.now()
    // One log line per frame is the norm, but a streamer may batch several: handle each on its own
    for (const line of data.toString().split(/\r?\n/)) {
      if (!line.trim()) continue
      rawLogLine(line)
      for (const evt of normalizeEvents(parseLine(line))) processLiveEvent(evt)
    }
  })
  robotWs.on('pong', () => { lastRobotActivity = Date.now() })

  robotWs.on('close', () => {
    stopRobotKeepAlive()
    console.log(`  Robot connection closed`)
    handleRobotDisconnect()
  })

  robotWs.on('error', (err) => {
    console.log(`  Robot connection error: ${err.message}`)
  })
}

let robotProbeTimer = null
let robotReconnectTimer = null
let staticReplayActive = false

// ── Static replay (fallback when no live robot) ─────────────────────────────

function startStaticReplay() {
  if (staticReplayActive) return
  if (!allEvents.length) {
    console.log('  Static replay requested but grocery_logs.txt has no events.')
    return
  }
  staticReplayActive = true
  sourceMode = 'static'
  broadcastSourceMode()
  console.log(`  No live robot — serving static replay of ${allEvents.length} events (mode: static).`)
  // REPLAY_START_DELAY=<ms> (tests): give a client time to connect before the first event
  const delay = parseInt(process.env.REPLAY_START_DELAY || '0', 10)
  if (delay > 0) globalTimeout = setTimeout(globalReplay, delay)
  else globalReplay()
}

function stopStaticReplay() {
  if (globalTimeout) { clearTimeout(globalTimeout); globalTimeout = null }
  staticReplayActive = false
}

// Gently poll for the real robot while we're serving static data, so a robot
// that comes online later gets picked up without restarting this server.
function startRobotProbe() {
  if (robotProbeTimer || !ROBOT_WS) return
  robotProbeTimer = setInterval(() => {
    if (!robotWs) {
      console.log(`  Probing for robot at ${ROBOT_WS}…`)
      connectToRobot()
    }
  }, ROBOT_PROBE_INTERVAL)
}

function stopRobotProbe() {
  if (robotProbeTimer) { clearInterval(robotProbeTimer); robotProbeTimer = null }
}

function handleRobotDisconnect() {
  robotWs = null
  // Real-connection-only: no static replay. Sit in 'waiting' and keep trying to
  // reach the robot at ROBOT_WS (olifant) with capped backoff until it's back.
  if (sourceMode !== 'waiting') {
    sourceMode = 'waiting'
    broadcastSourceMode()
  }
  const backoff = Math.min(1000 * Math.pow(2, Math.min(liveAttempts, 5)), 15000)
  console.log(`  No robot at ${ROBOT_WS} — retrying in ${(backoff / 1000).toFixed(1)}s…`)
  if (robotReconnectTimer) clearTimeout(robotReconnectTimer)
  robotReconnectTimer = setTimeout(() => { robotReconnectTimer = null; connectToRobot() }, backoff)
}

// ── Global replay loop (static mode) ────────────────────────────────────────

function globalReplay() {
  loopCount++
  nextOrderIdToAssign = nextOrderId()
  cycleWritten = false
  currentItem = null
  cycleHistory = []

  function sendEvent(idx) {
    if (idx >= allEvents.length) {
      stopHeartbeat()
      console.log(`  Loop ${loopCount} complete. Pausing ${LOOP_PAUSE / 1000}s before next loop…`)
      // REPLAY_ONCE=1 (tests): one pass through the log, then stop sending events
      if (process.env.REPLAY_ONCE === '1') { saveReplayState(); return }
      saveReplayState()
      globalTimeout = setTimeout(globalReplay, LOOP_PAUSE / REPLAY_SPEED)
      return
    }

    currentEventIndex = idx
    const evt = allEvents[idx]
    if (PROFILE.observe) PROFILE.observe(evt)
    if (runDetails.observe(evt)) announceRunDetails(evt)

    // ── Cycle bookkeeping
    if (evt.type === 'cycle_start') {
      cycleWritten = false
      currentItem = null
      currentCycleIsAnomaly = false
      cycleStartTime = Date.now()
      rawStepLog = []
      stepStart = Date.now()
      stepComponent = null
      stepMeta = {}
      cycleFailures = []
      retryCount = 0
      waypointsSearched = []
      waypointFoundAt = null
      graspWidth = null
      collisionWarnings = 0
      cycleImages = []
      lastFailComponent = null
      cycleHistory = []
      cycleCritic = null
    }

    if (evt.type === 'object_selected') {
      currentItem = evt.objectName
      if (!isValidItem(evt.objectName)) {
        currentCycleIsAnomaly = true
        console.log(`  Anomaly input: '${evt.objectName}' — skipping cycle`)
      }
    }

    // The AI Judge's events (replay)
    if (evt.type === 'critic') {
      handleCriticEvent(evt)
      saveReplayState()
      startHeartbeat()
      const nextDelay = (idx + 1 < delays.length) ? delays[idx + 1] : 50
      globalTimeout = setTimeout(() => sendEvent(idx + 1), nextDelay)
      return
    }

    // Save failure images (replay mode — images come from log file)
    if (evt.type === 'image') {
      console.log(`  Processing image: ${evt.imageId} (b64 len: ${evt.base64?.length || 0}, failComp: ${lastFailComponent})`)
      const filePath = saveImage(evt.imageId, evt.base64)
      if (filePath) {
        console.log(`  Image saved: ${evt.imageId} → ${filePath}`)
        const ref = failureImageEvent(evt, lastFailComponent, '')
        cycleHistory.push(ref)
        broadcast(ref)
        cycleImages.push({
          imageId: evt.imageId,
          camera: evt.camera,
          description: evt.description,
          failComponent: lastFailComponent,
          ts: evt.ts,
        })
      } else {
        console.log(`  Image save FAILED for ${evt.imageId}`)
      }
      const nextDelay = (idx + 1 < delays.length) ? delays[idx + 1] : 50
      globalTimeout = setTimeout(() => sendEvent(idx + 1), nextDelay)
      return
    }

    // ── Phase events: track steps and failures
    if (evt.type === 'phase') {
      // Flush previous step when component changes
      const currentPhase = _compToPhase[evt.component]
      const prevPhase = _compToPhase[stepComponent]
      if (stepComponent && currentPhase !== prevPhase) {
        flushStep()
        stepStart = Date.now()
        stepComponent = evt.component
        stepMeta = {}
      } else if (!stepComponent) {
        stepStart = Date.now()
        stepComponent = evt.component
        stepMeta = {}
      }

      // Track waypoints searched
      if (evt.component === 'SEARCH_DETECT' && evt.waypoint) {
        if (!waypointsSearched.includes(evt.waypoint)) {
          waypointsSearched.push(evt.waypoint)
        }
        if (evt.status === 'SUCCESS') waypointFoundAt = evt.waypoint
      }

      // Track retries
      if (evt.component === 'CLOSEUP_RETRY' && evt.status === 'BEGIN') {
        retryCount++
        cycleFailures.push({ level: 'orange', message: evt.detail || 'Grasp retry', component: evt.component })
      }

      // Track grasp width
      if (evt.component === 'SYNTHESISE' && evt.status === 'SUCCESS') {
        const wm = evt.detail?.match(/width=([\d.]+) mm/)
        if (wm) graspWidth = parseFloat(wm[1])
      }

      // Track failures
      if (evt.status === 'FAIL') {
        lastFailComponent = evt.component
        const d = evt.detail || ''
        const fc = PROFILE.failureClass ? PROFILE.failureClass(evt) : null
        const isCritical = fc ? fc === 'red' : (evt.component === 'EXECUTE_GRASP' || evt.component === 'HANDOVER_MOVE'
          || evt.component === 'CLOSEUP_LIFT'
          || d.includes('search exhausted') || d.includes('no_valid_depth') || d.includes('no valid depth')
          || d.includes('handover failed'))
        if (isCritical) {
          cycleFailures.push({ level: 'red', message: (PROFILE.failureMessage ? PROFILE.failureMessage(evt) : evt.detail) || `${evt.component} failed`, component: evt.component })
        } else if (fc === 'orange') {
          cycleFailures.push({ level: 'orange', message: PROFILE.failureMessage ? PROFILE.failureMessage(evt) : (evt.detail || `${evt.component} failed`), component: evt.component })
        } else if (evt.component === 'SEARCH_DETECT') {
          cycleFailures.push({ level: 'orange', message: `No detections at ${evt.waypoint || 'waypoint'}`, component: evt.component })
        } else if (evt.component === 'ITEM_CHECK') {
          cycleFailures.push({ level: 'orange', message: 'AI Judge: not holding the item', component: evt.component, reason: 'item_not_held' })
        }
      }

      // Extract meta
      if (evt.component === 'ANCHOR_SELECT' && evt.status === 'SUCCESS') {
        const m = evt.detail?.match(/selected=#1\(d=([\d.]+)cm,score=([\d.]+)\)/)
        if (m) {
          stepMeta.anchor_distance_cm = parseFloat(m[1])
          stepMeta.anchor_score = parseFloat(m[2])
        }
      }
      if (evt.component === 'CLOSEUP_REFINE' && evt.status === 'SUCCESS') {
        const m = evt.detail?.match(/score=([\d.]+) area=(\d+)px/)
        if (m) {
          stepMeta.refine_score = parseFloat(m[1])
          stepMeta.refine_area_px = parseInt(m[2])
        }
      }
      if (evt.component === 'CLOSEUP_LIFT' && evt.status === 'SUCCESS') {
        const m = evt.detail?.match(/depth_med=([\d.]+)/)
        if (m) stepMeta.depth_m = parseFloat(m[1])
      }
      if (PROFILE.meta) Object.assign(stepMeta, PROFILE.meta(evt))
    }

    // Track collision warnings
    if (evt.type === 'collision_warning') {
      collisionWarnings++
      // Don't broadcast collision warnings, just track
      const nextDelay = (idx + 1 < delays.length) ? delays[idx + 1] : 50
      globalTimeout = setTimeout(() => sendEvent(idx + 1), nextDelay)
      return
    }

    // Track gripper failures
    if (evt.type === 'gripper' && !evt.success) {
      cycleFailures.push({ level: 'red', message: evt.message || 'Gripper failure', component: 'GRIPPER' })
    }

    // Track motion meta
    if (evt.type === 'motion' && stepComponent) {
      stepMeta.trajectory_duration = evt.duration
    }

    // ── Cycle end: write order (skip anomaly cycles)
    if (evt.type === 'cycle_end' && cycleStartTime && currentItem && !currentCycleIsAnomaly) {
      writeCompletedOrder(evt.outcome, evt.detail)
    }

    // ── Idle ticks: throttle to max one broadcast per 5s ────────────────────
    if (evt.type === 'idle_tick') {
      const now = Date.now()
      if (now - lastIdleBroadcast > 5000) {
        lastIdleBroadcast = now
        broadcast({ type: 'system_state', state: 'idle', ts: evt.ts, detail: evt.detail })
      }
      const nextDelay = (idx + 1 < delays.length) ? delays[idx + 1] : 50
      globalTimeout = setTimeout(() => sendEvent(idx + 1), nextDelay)
      return
    }

    // ── Calibration, prompt_activity, faults: broadcast but don't add to cycle history
    if (evt.type === 'calibration' || evt.type === 'prompt_activity' || evt.type === 'fault_recovery') {
      broadcast(evt)
      const nextDelay = (idx + 1 < delays.length) ? delays[idx + 1] : 50
      globalTimeout = setTimeout(() => sendEvent(idx + 1), nextDelay)
      return
    }

    if (evt.type === 'system_fault') {
      if (evt.status === 'FAIL') {
        cycleFailures.push({
          level: evt.severity === 'red' ? 'red' : 'orange',
          message: evt.plain || evt.detail || `${evt.source} fault`,
          component: evt.source?.toUpperCase() || 'BRIDGE',
          phase: _compToPhase[stepComponent]?.phase || null,
          ...(evt.reason ? { reason: evt.reason } : {}),
        })
      }
      if (evt.severity === 'red') cycleHistory.push(evt)
      broadcast(evt)
      const nextDelay = (idx + 1 < delays.length) ? delays[idx + 1] : 50
      globalTimeout = setTimeout(() => sendEvent(idx + 1), nextDelay)
      return
    }

    // Skip system_event from broadcast (internal bookkeeping)
    if (evt.type === 'system_event') {
      const nextDelay = (idx + 1 < delays.length) ? delays[idx + 1] : 50
      globalTimeout = setTimeout(() => sendEvent(idx + 1), nextDelay)
      return
    }

    // Prepare payload
    const payload = { ...evt }
    if (payload.type === 'cycle_start') {
      payload.cycleNum = nextOrderIdToAssign
    }

    cycleHistory.push(payload)
    broadcast(payload)
    saveReplayState()

    startHeartbeat()
    const nextDelay = (idx + 1 < delays.length) ? delays[idx + 1] : 50
    globalTimeout = setTimeout(() => sendEvent(idx + 1), nextDelay)
  }

  sendEvent(0)
}

// ── HTTP + WebSocket server ──────────────────────────────────────────────────

const url = require('url')

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const parsedUrl = url.parse(req.url, true)
  const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/'
  const query = parsedUrl.query

  if (pathname === '/api/recent-orders') {
    const orders = readOrders()
    const recent = orders.slice(-2).reverse()
    const failed = orders.filter(o => o.status === 'failed').length
    const weeklyCaption = readLatestCaption('weekly')
    // "Today so far": numbers for one local calendar day (?date=YYYY-MM-DD for tests).
    const p2 = (n) => String(n).padStart(2, '0')
    const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` }
    const dayStr = query.date || localDay(new Date().toISOString())
    const todays = orders.filter(o => o.started_at && localDay(o.started_at) === dayStr)
    const secs = todays.map(o => o.total_seconds || 0).filter(x => x > 0)
    const today = {
      date: dayStr,
      total: todays.length,
      delivered: todays.filter(o => o.status === 'success' || o.status === 'ok').length,
      warning: todays.filter(o => o.status === 'warning').length,
      failed: todays.filter(o => o.status === 'failed').length,
      avg_seconds: secs.length ? Math.round(secs.reduce((a, b) => a + b, 0) / secs.length) : 0,
      recent: todays.slice(-2).reverse().map(o => ({
        id: o.id, order_number: o.order_number, item: o.item, status: o.status,
        failure: o.failure ? { reason: o.failure.reason } : null,
        completed_at: o.completed_at, total_seconds: o.total_seconds || 0,
      })),
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ total: orders.length, failedCount: failed, recent, today, cached_weekly_caption: weeklyCaption }))

  } else if (pathname === '/api/orders/daily') {
    const orders = readOrders()
    const today = new Date().toISOString().slice(0, 10)
    const from = query.from || (() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10) })()
    const to = query.to || today

    const buckets = {}
    let d = new Date(from + 'T12:00:00')
    const endD = new Date(to + 'T12:00:00')
    while (d <= endD) {
      buckets[d.toISOString().slice(0, 10)] = { delivered: 0, warning: 0, failed: 0 }
      d.setDate(d.getDate() + 1)
    }

    const filtered = orders.filter(o => {
      const dt = (o.started_at || '').slice(0, 10)
      return dt >= from && dt <= to
    })

    for (const o of filtered) {
      const dt = (o.started_at || '').slice(0, 10)
      if (buckets[dt]) {
        if (o.status === 'warning') buckets[dt].warning++
        else if (o.status === 'success' || o.status === 'ok') buckets[dt].delivered++
        else buckets[dt].failed++
      }
    }

    const days = Object.entries(buckets).sort().map(([date, v]) => ({ date, ...v }))
    const robotTimes = filtered.filter(o => (o.robot_seconds || 0) > 0).map(o => o.robot_seconds)
    const avgFetch = robotTimes.length > 0 ? Math.round(robotTimes.reduce((a, b) => a + b, 0) / robotTimes.length) : 0
    const totalDelivered = days.reduce((s, d) => s + d.delivered, 0)
    const totalWarning = days.reduce((s, d) => s + d.warning, 0)
    const totalFailed = days.reduce((s, d) => s + d.failed, 0)

    // The chart no longer renders an AI caption — the weekly summary in the
    // top card is the single source of narrative summary, and the chart's
    // tiles already convey the numbers directly. So we don't embed a cached
    // caption here either; saves a disk read on every fetch.
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      from, to,
      days,
      totals: { delivered: totalDelivered, warning: totalWarning, failed: totalFailed, avg_fetch_seconds: avgFetch },
    }))

  } else if (pathname === '/api/orders/slim') {
    // Just the fields the Live page needs for typical times and outcomes (no images, no step meta).
    const orders = readOrders().map(o => ({
      id: o.id, item: o.item, status: o.status, started_at: o.started_at,
      failure: o.failure ? { reason: o.failure.reason } : null,
      retries: o.retries || 0, total_seconds: o.total_seconds || 0, grasp_width_mm: o.grasp_width_mm ?? null,
      // where the item was and how many tries it took (from run_details), for the counterfactual cards
      item_position_m: o.run_details?.item_position_m ?? null, shelf_row: o.run_details?.shelf_row ?? null, shelf_side: o.run_details?.shelf_side ?? null,
      attempt_count: o.run_details?.attempt_count ?? null, needed_more_than_one_try: o.run_details?.needed_more_than_one_try ?? null,
      robot_clock_started_at: o.run_details?.robot_clock_started_at ?? null,
      steps: (o.steps || []).map(s => ({ phase: s.phase, duration_seconds: s.duration_seconds || 0 })),
    }))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(orders))

  } else if (pathname === '/api/orders/times') {
    // Minimal rows for the activity heatmap; the browser buckets them in local time.
    const orders = readOrders()
    const today = new Date().toISOString().slice(0, 10)
    const from = query.from || (() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10) })()
    const to = query.to || today
    // Pad a day each side: the date filter is on the UTC date, bucketing is local.
    const lo = new Date(from + 'T00:00:00'); lo.setDate(lo.getDate() - 1)
    const hi = new Date(to + 'T23:59:59'); hi.setDate(hi.getDate() + 1)
    const rows = orders
      .filter(o => o.started_at && new Date(o.started_at) >= lo && new Date(o.started_at) <= hi)
      .map(o => ({ t: o.started_at, s: o.status === 'ok' ? 'success' : o.status, item: o.item }))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ from, to, orders: rows }))

  } else if (pathname === '/api/orders/list') {
    const orders = readOrders()
    const today = new Date().toISOString().slice(0, 10)
    const from = query.from || (() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10) })()
    const to = query.to || today
    const statusFilter = query.status || 'all'
    const itemFilter = query.item || 'all'

    let inRange = orders.filter(o => {
      const dt = (o.started_at || '').slice(0, 10)
      return dt >= from && dt <= to
    })

    const allCount = inRange.length

    // Helper predicates so we can compose status + item filters.
    const matchStatus = (o, s) =>
      s === 'all' ? true
      : s === 'delivered' ? (o.status === 'success' || o.status === 'ok')
      : o.status === s
    // `item` may list several items, comma-separated (the Orders item dropdown is multi-select)
    const matchItem = (o, it) => it === 'all' ? true : it.split(',').includes(o.item)

    // Status chip counts reflect the *currently active item filter* so when
    // sock is selected, "Failed" shows the number of failed socks, not the
    // number of failed orders overall.
    const itemScoped = inRange.filter(o => matchItem(o, itemFilter))
    const deliveredCount = itemScoped.filter(o => matchStatus(o, 'delivered')).length
    const warningCount   = itemScoped.filter(o => matchStatus(o, 'warning')).length
    const failedCount    = itemScoped.filter(o => matchStatus(o, 'failed')).length

    // Item chip counts likewise reflect the active status filter.
    const statusScoped = inRange.filter(o => matchStatus(o, statusFilter))
    const byItem = {}
    for (const o of statusScoped) {
      const item = o.item || 'unknown'
      byItem[item] = (byItem[item] || 0) + 1
    }

    // The actual rows shown — both filters applied.
    let filtered = inRange.filter(o => matchStatus(o, statusFilter) && matchItem(o, itemFilter))

    filtered.sort((a, b) => ((b.completed_at || b.started_at || '')).localeCompare(a.completed_at || a.started_at || ''))

    const resultOrders = filtered.map(o => ({
      id: o.id,
      order_number: o.order_number || String(o.id || ''),
      item: o.item,
      status: o.status,
      failure: o.failure || null,
      started_at: o.started_at,
      completed_at: o.completed_at,
      total_seconds: o.total_seconds || 0,
      robot_seconds: o.robot_seconds || 0,
      human_wait_seconds: o.human_wait_seconds || 0,
      retries: o.retries || 0,
      waypoints_searched: o.waypoints_searched || [],
      grasp_width_mm: o.grasp_width_mm || null,
      collision_warnings: o.collision_warnings || 0,
      phases: o.steps || [],
      robot: o.robot || ROBOT_ID,
      // facts a robot's profile saves on its orders (the bar: bottle, glasses, pour, rack…)
      ...Object.fromEntries(['bottle', 'glasses', 'glasses_filled', 'poured', 'customer_seen', 'decap_skipped', 'shake_unsafe', 'rack_bottles', 'critic', 'handover', 'run_details']
        .filter(k => o[k] !== undefined).map(k => [k, o[k]])),
    }))

    const sortedByItem = Object.entries(byItem).sort((a, b) => b[1] - a[1])
    const byItemObj = {}
    for (const [k, v] of sortedByItem) byItemObj[k] = v

    // Orders list no longer carries an AI caption — the chips and rows
    // already show everything the caption used to summarise.
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      filter: { from, to, status: statusFilter, item: itemFilter },
      counts: { all: allCount, delivered: deliveredCount, warning: warningCount, failed: failedCount, by_item: byItemObj },
      orders: resultOrders,
    }))

  } else if (pathname === '/api/orders') {
    const orders = readOrders()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(orders))

  } else if (pathname === '/api/source') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ mode: sourceMode, robot: ROBOT_ID, robotWs: ROBOT_WS || null }))

  } else if (pathname.startsWith('/api/images/') && req.method === 'GET') {
    const imageId = pathname.replace('/api/images/', '')
    if (!imageId || imageId.includes('..') || imageId.includes('/')) {
      res.writeHead(400); res.end('Invalid image ID'); return
    }
    const extMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.bmp': 'image/bmp', '.png': 'image/png' }
    const tryExts = ['.jpg', '.jpeg', '.bmp', '.png']
    let found = false
    // a replay keeps its own folder; pictures the robot saved earlier in the repository's data/images are served too
    const dirs = [IMAGES_DIR, path.join(__dirname, 'data', 'images')]
    for (const [dir, ext] of dirs.flatMap(d => tryExts.map(e => [d, e]))) {
      const filePath = path.join(dir, `${imageId}${ext}`)
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath)
        res.writeHead(200, { 'Content-Type': extMap[ext], 'Cache-Control': 'public, max-age=86400' })
        res.end(data)
        found = true
        break
      }
    }
    if (!found) {
      res.writeHead(404); res.end('Image not found')
    }

  } else if (pathname === '/api/upload-image' && req.method === 'POST') {
    // Upload tool: POST /api/upload-image?id=fail_xxx  body = raw image bytes
    const imageId = query.id
    if (!imageId || imageId.includes('..') || imageId.includes('/')) {
      res.writeHead(400); res.end('Invalid image ID'); return
    }
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const buf = Buffer.concat(chunks)
      // Detect type from magic bytes
      let ext = '.jpg'
      if (buf[0] === 0x89 && buf[1] === 0x50) ext = '.png'
      else if (buf[0] === 0x42 && buf[1] === 0x4D) ext = '.bmp'
      const filePath = path.join(IMAGES_DIR, `${imageId}${ext}`)
      fs.writeFileSync(filePath, buf)
      console.log(`  Image uploaded: ${imageId}${ext} (${buf.length} bytes)`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, imageId, ext, size: buf.length }))
    })

  } else {
    res.writeHead(404)
    res.end('Not found')
  }
})

const wss = new WebSocketServer({ server })

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  WebSocket: ws://0.0.0.0:${PORT}`)
  console.log(`  HTTP API:  http://0.0.0.0:${PORT}/api/recent-orders`)
  if (ENABLE_STATIC_REPLAY) {
    console.log(`  Robot:     none — STATIC_REPLAY=1, replaying ${path.basename(LOG_FILE)} into ${ORDERS_DIR}\n`)
    startStaticReplay()
  } else {
    console.log(`  Robot:     ${ROBOT_WS} (real connection only — no static replay)\n`)
    connectToRobot()
  }
})

wss.on('connection', (ws) => {
  console.log(`Client connected — sending ${cycleHistory.length} catch-up events (mode: ${sourceMode})`)

  // Tell client which mode we're in
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'source_mode', mode: sourceMode, robot: ROBOT_ID }))
  }

  for (const evt of cycleHistory) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ ...evt, _catchUp: true, _cycleStartedAt: cycleStartTime }))
    }
  }

  // ── Liveness: ping every 25 s, drop the socket if no pong by the next tick.
  // iPads/iOS aggressively sleep idle TCP sockets; without server-side pings
  // the connection appears alive on the JS side long after the network died,
  // and the dashboard sits silent. ws auto-replies to pongs so the JS client
  // doesn't need any handling.
  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw)
      if (msg.type === 'intervene') {
        console.log('  Employee intervention received')
      }
    } catch {}
  })

  ws.on('close', () => console.log('Client disconnected'))
})

// Global keep-alive sweep
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      console.log('  Client failed ping — terminating')
      try { ws.terminate() } catch {}
      continue
    }
    ws.isAlive = false
    try { ws.ping() } catch {}
  }
}, 25_000)
