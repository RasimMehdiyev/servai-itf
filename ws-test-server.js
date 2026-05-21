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

const PORT = parseInt(process.env.WS_PORT || '8765', 10)
const REPLAY_SPEED = parseFloat(process.env.REPLAY_SPEED || '1.0')
const ROBOT_WS = process.env.ROBOT_WS || 'ws://olifant.local:7878'
const LIVE_RECONNECT_ATTEMPTS = parseInt(process.env.LIVE_RETRIES || '5', 10)
const ROBOT_PROBE_INTERVAL = 30_000  // check for robot every 30s while in static mode
const LOG_FILE = path.join(__dirname, 'grocery_logs.txt')
const ORDERS_DIR = path.join(__dirname, 'data')
const ORDERS_FILE = path.join(ORDERS_DIR, 'orders.json')
const STATE_FILE = path.join(ORDERS_DIR, 'replay-state.json')
const LOOP_PAUSE = 5000
const HEARTBEAT_INTERVAL = 4000
const MAX_EVENT_DELAY = 5000

const CAPTION_CACHE_DIR = path.join(__dirname, 'data', 'cache', 'captions')
const VISION_CACHE_DIR = path.join(__dirname, 'data', 'cache', 'vision')

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

// Source mode: 'live' (robot WS connected), 'waiting' (still trying to reach robot)
// Static file replay has been removed — the dashboard waits for the live robot.
let sourceMode = 'waiting'

// ── Valid stock items (anything else is treated as accidental input) ─────────
const VALID_STOCK = ['pen', 'ball', 't-shirt', 'water bottle', 'phone holder', 'towel', 'sock', 'coffee mug']
function isValidItem(name) {
  const n = (name || '').toLowerCase().trim()
  return VALID_STOCK.some(v => n.includes(v) || v.includes(n))
}

// ── Phase mapping (mirrors src/lib/phases.js) ───────────────────────────────

const PHASES = [
  { phase: 'scene_scan',    friendly_name: 'Scanning the scene',  components: ['SCENE_SCAN'] },
  { phase: 'searching',     friendly_name: 'Searching for item',  components: ['SEARCH_DETECT'] },
  { phase: 'anchor_select', friendly_name: 'Selecting target',    components: ['ANCHOR_SELECT'] },
  { phase: 'closeup_move',  friendly_name: 'Moving closer',       components: ['CLOSEUP_MOVE'] },
  { phase: 'analyzing',     friendly_name: 'Analyzing the grasp', components: ['CLOSEUP_MOLMO', 'CLOSEUP_REFINE', 'CLOSEUP_LIFT', 'SYNTHESISE', 'VISUALISE'] },
  { phase: 'grasping',      friendly_name: 'Picking up',          components: ['EXECUTE_GRASP', 'CLOSEUP_RETRY'] },
  { phase: 'bringing_over', friendly_name: 'Bringing it over',    components: ['HANDOVER_TRANSIT', 'HANDOVER_MOVE'] },
  { phase: 'handing_over',  friendly_name: 'Handing over',        components: ['HANDOVER_RELEASE'] },
  { phase: 'returning',     friendly_name: 'Returning',           components: ['HANDOVER_RETURN', 'RETURN_HOME'] },
]

const _compToPhase = {}
for (const p of PHASES) for (const c of p.components) _compToPhase[c] = p

// ── Failure classification ───────────────────────────────────────────────────

function classifyFailure(detail) {
  const d = (detail || '').toLowerCase()
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

function readOrders() {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')) }
  catch { return [] }
}

function writeOrder(entry) {
  const orders = readOrders()
  orders.push(entry)
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2))
}

function nextOrderId() {
  const orders = readOrders()
  if (!orders.length) return 1
  return Math.max(...orders.map(o => o.id)) + 1
}

// ── Single-line parser (used by both file replay and live stream) ───────────

const _parserState = { lastTimestamp: null }

function parseLine(rawLine) {
  const line = rawLine.replace(/\r$/, '')

  if (!line.trim()) return null
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
      || line.match(/close gripper\?/) || line.match(/release object/)
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

    if (component === 'CYCLE' && status === 'BEGIN') {
      const m = detail.match(/cycle #?(\d+)/)
      return { ts: _parserState.lastTimestamp, type: 'cycle_start', cycleNum: m ? parseInt(m[1]) : 0 }
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
      return {
        ts: _parserState.lastTimestamp, type: 'gripper', success: status === 'SUCCESS',
        message: isOpen ? 'Gripper opened' : 'Gripper closed',
        raw: detail,
      }
    }

    if (component === 'EXECUTOR' && action === 'TRAJECTORY') {
      return { ts: _parserState.lastTimestamp, type: 'system_event', text: detail }
    }

    if (component === 'EXECUTOR' && action === 'SHUTDOWN') {
      return { ts: _parserState.lastTimestamp, type: 'executor_shutdown', detail }
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

function parseLog(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  const events = []
  _parserState.lastTimestamp = null

  for (const rawLine of raw) {
    const evt = parseLine(rawLine)
    if (evt) events.push(evt)
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
      delays.push(Math.min(curr - prev, MAX_EVENT_DELAY) / REPLAY_SPEED)
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

function saveImage(imageId, base64) {
  // Never overwrite an existing image (allows manual placement of real photos)
  const existing = findExistingImage(imageId)
  if (existing) return existing

  const buf = Buffer.from(base64, 'base64')
  const ext = detectImageExtFromBuffer(buf)
  const filePath = path.join(IMAGES_DIR, `${imageId}${ext}`)
  try {
    fs.writeFileSync(filePath, buf)
    return filePath
  } catch (e) {
    console.log(`  Failed to save image ${imageId}: ${e.message}`)
    return null
  }
}

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
      reason: classifyFailure(f.message || failDetail),
      detail: f.message || failDetail,
      at_phase: phaseOfFailure(f),
    }
  } else if (status === 'warning') {
    const f = cycleFailures.find(f => f.level === 'red')
    if (f) {
      failure = {
        reason: classifyFailure(f.message),
        detail: f.message,
        at_phase: phaseOfFailure(f) || 'analyzing',
      }
    }
  }

  const steps = groupEventsIntoPhases(rawStepLog)

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
    robot_id: 'ROBI',
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
  broadcast({ type: 'source_mode', mode: sourceMode })
}

function processLiveEvent(evt) {
  if (!evt) return

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
  }

  if (evt.type === 'object_selected') {
    currentItem = evt.objectName
    if (!isValidItem(evt.objectName)) {
      currentCycleIsAnomaly = true
      console.log(`  Anomaly input: '${evt.objectName}' — skipping cycle`)
    }
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
      const isCritical = evt.component === 'EXECUTE_GRASP' || evt.component === 'HANDOVER_MOVE'
        || evt.component === 'CLOSEUP_LIFT'
        || d.includes('search exhausted') || d.includes('no_valid_depth') || d.includes('no valid depth')
        || d.includes('handover failed')
      if (isCritical) {
        cycleFailures.push({ level: 'red', message: evt.detail || `${evt.component} failed`, component: evt.component })
      } else if (evt.component === 'SEARCH_DETECT') {
        cycleFailures.push({ level: 'orange', message: `No detections at ${evt.waypoint || 'waypoint'}`, component: evt.component })
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
        level: 'orange',
        message: evt.detail || `${evt.source} fault`,
        component: evt.source?.toUpperCase() || 'BRIDGE',
        phase: activePhase,
      })
    }
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
    sourceMode = 'live'
    console.log(`  Connected to robot at ${ROBOT_WS}`)
    broadcastSourceMode()
    _parserState.lastTimestamp = null
  })

  robotWs.on('message', (data) => {
    const line = data.toString()
    const evt = parseLine(line)
    if (evt) processLiveEvent(evt)
  })

  robotWs.on('close', () => {
    console.log(`  Robot connection closed`)
    handleRobotDisconnect()
  })

  robotWs.on('error', (err) => {
    console.log(`  Robot connection error: ${err.message}`)
  })
}

let robotProbeTimer = null

function stopStaticReplay() {
  if (globalTimeout) { clearTimeout(globalTimeout); globalTimeout = null }
}

function handleRobotDisconnect() {
  robotWs = null
  // Keep trying to reach the robot indefinitely — capped exponential backoff.
  // The dashboard sits in 'waiting' mode until the robot comes online.
  if (sourceMode !== 'waiting') {
    sourceMode = 'waiting'
    broadcastSourceMode()
  }
  const backoff = Math.min(1000 * Math.pow(2, Math.min(liveAttempts, 5)), 15000)
  console.log(`  Waiting for robot — retrying in ${(backoff / 1000).toFixed(1)}s…`)
  setTimeout(connectToRobot, backoff)
}

// No-op shims kept for backward compatibility with older call sites.
function startRobotProbe() {}
function stopRobotProbe() {}

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
      saveReplayState()
      globalTimeout = setTimeout(globalReplay, LOOP_PAUSE / REPLAY_SPEED)
      return
    }

    currentEventIndex = idx
    const evt = allEvents[idx]

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
    }

    if (evt.type === 'object_selected') {
      currentItem = evt.objectName
      if (!isValidItem(evt.objectName)) {
        currentCycleIsAnomaly = true
        console.log(`  Anomaly input: '${evt.objectName}' — skipping cycle`)
      }
    }

    // Save failure images (replay mode — images come from log file)
    if (evt.type === 'image') {
      console.log(`  Processing image: ${evt.imageId} (b64 len: ${evt.base64?.length || 0}, failComp: ${lastFailComponent})`)
      const filePath = saveImage(evt.imageId, evt.base64)
      if (filePath) {
        console.log(`  Image saved: ${evt.imageId} → ${filePath}`)
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
        const isCritical = evt.component === 'EXECUTE_GRASP' || evt.component === 'HANDOVER_MOVE'
          || evt.component === 'CLOSEUP_LIFT'
          || d.includes('search exhausted') || d.includes('no_valid_depth') || d.includes('no valid depth')
          || d.includes('handover failed')
        if (isCritical) {
          cycleFailures.push({ level: 'red', message: evt.detail || `${evt.component} failed`, component: evt.component })
        } else if (evt.component === 'SEARCH_DETECT') {
          cycleFailures.push({ level: 'orange', message: `No detections at ${evt.waypoint || 'waypoint'}`, component: evt.component })
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
        cycleFailures.push({ level: 'orange', message: evt.detail || `${evt.source} fault`, component: evt.source?.toUpperCase() || 'BRIDGE' })
      }
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
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ total: orders.length, failedCount: failed, recent, cached_weekly_caption: weeklyCaption }))

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

    const cachedCaption = readLatestCaption('chart')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      from, to,
      days,
      totals: { delivered: totalDelivered, warning: totalWarning, failed: totalFailed, avg_fetch_seconds: avgFetch },
      cached_caption: cachedCaption,
    }))

  } else if (pathname === '/api/orders/list') {
    const orders = readOrders()
    const today = new Date().toISOString().slice(0, 10)
    const from = query.from || (() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10) })()
    const to = query.to || today
    const statusFilter = query.status || 'all'
    const itemFilter = query.item || 'all'

    let filtered = orders.filter(o => {
      const dt = (o.started_at || '').slice(0, 10)
      return dt >= from && dt <= to
    })

    const allCount = filtered.length
    const deliveredCount = filtered.filter(o => o.status === 'success' || o.status === 'ok').length
    const warningCount = filtered.filter(o => o.status === 'warning').length
    const failedCount = filtered.filter(o => o.status === 'failed').length
    const byItem = {}
    for (const o of filtered) {
      const item = o.item || 'unknown'
      byItem[item] = (byItem[item] || 0) + 1
    }

    if (statusFilter === 'delivered') {
      filtered = filtered.filter(o => o.status === 'success' || o.status === 'ok')
    } else if (statusFilter === 'warning') {
      filtered = filtered.filter(o => o.status === 'warning')
    } else if (statusFilter === 'failed') {
      filtered = filtered.filter(o => o.status === 'failed')
    }
    if (itemFilter !== 'all') {
      filtered = filtered.filter(o => o.item === itemFilter)
    }

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
    }))

    const sortedByItem = Object.entries(byItem).sort((a, b) => b[1] - a[1])
    const byItemObj = {}
    for (const [k, v] of sortedByItem) byItemObj[k] = v

    const cachedCaption = readLatestCaption('orders_list')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      filter: { from, to, status: statusFilter, item: itemFilter },
      counts: { all: allCount, delivered: deliveredCount, warning: warningCount, failed: failedCount, by_item: byItemObj },
      orders: resultOrders,
      cached_caption: cachedCaption,
    }))

  } else if (pathname === '/api/orders') {
    const orders = readOrders()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(orders))

  } else if (pathname === '/api/source') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ mode: sourceMode, robotWs: ROBOT_WS || null }))

  } else if (pathname.startsWith('/api/images/') && req.method === 'GET') {
    const imageId = pathname.replace('/api/images/', '')
    if (!imageId || imageId.includes('..') || imageId.includes('/')) {
      res.writeHead(400); res.end('Invalid image ID'); return
    }
    const extMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.bmp': 'image/bmp', '.png': 'image/png' }
    const tryExts = ['.jpg', '.jpeg', '.bmp', '.png']
    let found = false
    for (const ext of tryExts) {
      const filePath = path.join(IMAGES_DIR, `${imageId}${ext}`)
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
  console.log(`  Robot:     ${ROBOT_WS} (waiting for live connection — no static fallback)\n`)
  connectToRobot()
})

wss.on('connection', (ws) => {
  console.log(`Client connected — sending ${cycleHistory.length} catch-up events (mode: ${sourceMode})`)

  // Tell client which mode we're in
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'source_mode', mode: sourceMode }))
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
