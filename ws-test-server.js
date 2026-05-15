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

const { WebSocketServer } = require('ws')
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = parseInt(process.env.WS_PORT || '8765', 10)
const REPLAY_SPEED = parseFloat(process.env.REPLAY_SPEED || '1.0')
const LOG_FILE = path.join(__dirname, 'grocery_logs.txt')
const ORDERS_DIR = path.join(__dirname, 'data')
const ORDERS_FILE = path.join(ORDERS_DIR, 'orders.json')
const STATE_FILE = path.join(ORDERS_DIR, 'replay-state.json')
const LOOP_PAUSE = 5000
const HEARTBEAT_INTERVAL = 4000
const MAX_EVENT_DELAY = 5000

// ── Valid stock items (anything else is treated as accidental input) ─────────
const VALID_STOCK = ['pen', 'ball', 't-shirt', 'water bottle', 'phone holder', 'towel']
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
  { phase: 'analyzing',     friendly_name: 'Analyzing the grasp', components: ['CLOSEUP_MOLMO', 'CLOSEUP_REFINE', 'CLOSEUP_LIFT', 'SYNTHESISE'] },
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

// ── Log parser (new structured format) ──────────────────────────────────────

function parseLog(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  const events = []
  let lastTimestamp = null

  for (const rawLine of raw) {
    const line = rawLine.replace(/\r$/, '')

    // Skip noise lines
    if (!line.trim()) continue
    if (line.startsWith('Traceback') || line.startsWith('  File ') || line.startsWith('    ')) continue
    if (line.startsWith('/home/') || line.startsWith('Loading checkpoint')
        || line.match(/^\d+%\|/) || line.startsWith('(viser)')
        || line.startsWith('╭') || line.startsWith('│') || line.startsWith('╰')) continue
    if (line.startsWith('WARNING:curobo')) {
      // Track collision warnings but don't emit as events
      events.push({ ts: lastTimestamp, type: 'collision_warning', raw: line })
      continue
    }
    if (line.trim() === 'y' || line.trim() === 'N' || line.trim() === 't-shirt') continue
    if (line.match(/^\[stage \d+/) || line.match(/^\[search →/) || line.match(/^\[return-home →/)
        || line.match(/^\[goto →/) || line.match(/^\[cycle \d+\] (known|enter)/)
        || line.match(/execute\? \[y\/N\]/) || line.match(/\?\s*\[y\/N\]/)
        || line.match(/close gripper\?/) || line.match(/release object/)
        || line.match(/^\[cycle \d+\] object>/) || line.match(/^\[cycle \d+\] '/)
        || line.match(/^  (import|warnings|torch)/)) continue

    // Handle lines where user input 'y' is concatenated with a timestamp (e.g. "y2026-05-14T...")
    if (line.match(/^y\d{4}-\d{2}-\d{2}T/)) {
      const cleaned = line.substring(1)
      const fixedMatch = cleaned.match(
        /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s*\|\s*(SYSTEM|WORKFLOW)\s*\|\s*([A-Z0-9_]+)(?::([A-Z0-9_]+))?\s*\|\s*(SUCCESS|FAIL|BEGIN|SKIP|FALLBACK)\s*\|\s*(.*)$/
      )
      if (fixedMatch) {
        lastTimestamp = fixedMatch[1]
        const component = fixedMatch[3]
        const status = fixedMatch[5]
        const detail = fixedMatch[6].trim()
        if (fixedMatch[2] === 'WORKFLOW') {
          events.push({ ts: lastTimestamp, type: 'phase', component, action: fixedMatch[4] || null, status, detail })
        } else {
          events.push({ ts: lastTimestamp, type: 'system_event', component, action: fixedMatch[4] || null, status, text: detail })
        }
      }
      continue
    }

    // ── Structured log: timestamp | LEVEL | COMPONENT[:ACTION] | STATUS | details
    // WORKFLOW lines: COMPONENT | STATUS (no colon)
    // SYSTEM lines: COMPONENT:ACTION | STATUS (with colon)
    const structured = line.match(
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s*\|\s*(SYSTEM|WORKFLOW)\s*\|\s*([A-Z0-9_]+)(?::([A-Z0-9_]+))?\s*\|\s*(SUCCESS|FAIL|BEGIN|SKIP|FALLBACK)\s*\|\s*(.*)$/
    )
    if (structured) {
      lastTimestamp = structured[1]
      const level = structured[2]
      const component = structured[3]
      const action = structured[4] || null  // null for WORKFLOW lines without :ACTION
      const status = structured[5]
      const detail = structured[6].trim()

      // Cycle boundaries
      if (component === 'CYCLE' && status === 'BEGIN') {
        const m = detail.match(/cycle (\d+)/)
        events.push({ ts: lastTimestamp, type: 'cycle_start', cycleNum: m ? parseInt(m[1]) : 0 })
        continue
      }
      if (component === 'CYCLE' && (status === 'SUCCESS' || status === 'FAIL')) {
        events.push({ ts: lastTimestamp, type: 'cycle_end', outcome: status, detail })
        continue
      }

      // Object prompt
      if (component === 'PROMPT' && status === 'SUCCESS') {
        const objMatch = detail.match(/object='([^']+)'/)
        const gotoMatch = detail.match(/goto '([^']+)'/)
        if (objMatch) {
          events.push({ ts: lastTimestamp, type: 'object_selected', objectName: objMatch[1] })
        }
        // goto commands → just emit as system_event, not a real cycle
        if (gotoMatch) {
          events.push({ ts: lastTimestamp, type: 'system_event', text: `goto ${gotoMatch[1]}` })
        }
        continue
      }
      if (component === 'PROMPT' && status === 'BEGIN') {
        events.push({ ts: lastTimestamp, type: 'system_event', text: detail })
        continue
      }

      // Search detect — extract waypoint
      if (component === 'SEARCH_DETECT') {
        const wpMatch = detail.match(/waypoint '([^']+)'/)
        events.push({
          ts: lastTimestamp, type: 'phase', component, action, status, detail,
          waypoint: wpMatch ? wpMatch[1] : null,
        })
        continue
      }

      // Gripper events
      if (component === 'GRIPPER') {
        const isOpen = action === 'OPEN'
        events.push({
          ts: lastTimestamp, type: 'gripper', success: true,
          message: isOpen ? 'Gripper opened' : 'Gripper closed',
          raw: detail,
        })
        continue
      }

      // Executor trajectory
      if (component === 'EXECUTOR' && action === 'TRAJECTORY') {
        events.push({ ts: lastTimestamp, type: 'system_event', text: detail })
        continue
      }

      // All other WORKFLOW/SYSTEM events → phase events
      if (level === 'WORKFLOW') {
        events.push({ ts: lastTimestamp, type: 'phase', component, action, status, detail })
        continue
      }

      // SYSTEM events
      events.push({ ts: lastTimestamp, type: 'system_event', component, action, status, text: detail })
      continue
    }

    // ── Loguru format: timestamp | LEVEL | module:func:line - message
    const loguru = line.match(
      /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s*\|\s*(\w+)\s+\|\s*([\w.:\-]+)\s*-\s*(.*)$/
    )
    if (loguru) {
      // Convert local timestamp to approximate ISO (offset assumed from log context)
      lastTimestamp = lastTimestamp || loguru[1]
      const logMessage = loguru[4].trim()

      if (logMessage.includes('Gripper result:')) {
        const m = logMessage.match(/success=(\w+), message=(.+)/)
        events.push({ ts: lastTimestamp, type: 'gripper', success: m?.[1] === 'True', message: m?.[2] || '', raw: logMessage })
      } else if (logMessage.includes('TrajectoryTarget envelope:')) {
        const dur = logMessage.match(/duration=([\d.]+)s/)
        const spd = logMessage.match(/speed_scale=([\d.]+)/)
        events.push({ ts: lastTimestamp, type: 'motion', duration: parseFloat(dur?.[1] || '0'), speedScale: parseFloat(spd?.[1] || '0.75'), raw: logMessage })
      } else if (logMessage.includes('robot status:') || logMessage.includes('robot_status:')) {
        events.push({ ts: lastTimestamp, type: 'robot_status', raw: logMessage })
      }
      continue
    }

    // ── [cycle N] object> name  (interactive input that wasn't skipped above)
    const objInput = line.match(/object>\s*(.+)$/)
    if (objInput) {
      const name = objInput[1].trim()
      if (name && name !== 'y' && name !== 'N' && name.length > 1) {
        // Will be handled by PROMPT SUCCESS event, skip duplicate
      }
      continue
    }
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
let orderIdBase = nextOrderId()
let cycleOffset = 0
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
      cycleOffset,
      orderIdBase,
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
  flushStep()
  const orderId = orderIdBase + cycleOffset - 1
  const hasCritical = cycleFailures.some(f => f.level === 'red')
  const hasOrange = cycleFailures.some(f => f.level === 'orange')

  let status
  if (outcome === 'FAIL') status = 'failed'
  else if (hasCritical || hasOrange || retryCount > 0) status = 'warning'
  else status = 'success'

  let failure = null
  if (status === 'failed') {
    const f = cycleFailures.find(f => f.level === 'red') || { message: failDetail || 'Unknown failure' }
    const phase = _compToPhase[f.component]
    failure = {
      reason: classifyFailure(f.message || failDetail),
      detail: f.message || failDetail,
      at_phase: phase?.phase || null,
    }
  } else if (status === 'warning') {
    const f = cycleFailures.find(f => f.level === 'orange')
    if (f) {
      const phase = _compToPhase[f.component]
      failure = {
        reason: classifyFailure(f.message),
        detail: f.message,
        at_phase: phase?.phase || 'analyzing',
      }
    }
  }

  const steps = groupEventsIntoPhases(rawStepLog)

  // Annotate each step with failure status for history UI coloring
  for (const step of steps) {
    const phaseFailures = cycleFailures.filter(f => {
      const failPhase = _compToPhase[f.component]
      return failPhase && failPhase.phase === step.phase
    })
    const hasRed = phaseFailures.some(f => f.level === 'red')
    const hasOrange = phaseFailures.some(f => f.level === 'orange')
    if (hasRed) {
      step.status = 'failed'
      step.failure_detail = classifyFailureFriendly(phaseFailures.find(f => f.level === 'red').message)
    } else if (hasOrange) {
      step.status = 'warning'
      step.failure_detail = phaseFailures.find(f => f.level === 'orange').message
    } else {
      step.status = 'ok'
    }
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
  console.log(`  Order #${orderId} (${currentItem}) [${status}] written to orders.json`)
}

// ── Global replay loop ──────────────────────────────────────────────────────

function globalReplay() {
  loopCount++
  orderIdBase = nextOrderId()
  cycleOffset = 0
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
      cycleOffset++
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
      cycleHistory = []
    }

    if (evt.type === 'object_selected') {
      currentItem = evt.objectName
      if (!isValidItem(evt.objectName)) {
        currentCycleIsAnomaly = true
        console.log(`  Anomaly input: '${evt.objectName}' — skipping cycle`)
      }
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

    // Skip system_event from broadcast (internal bookkeeping)
    if (evt.type === 'system_event') {
      const nextDelay = (idx + 1 < delays.length) ? delays[idx + 1] : 50
      globalTimeout = setTimeout(() => sendEvent(idx + 1), nextDelay)
      return
    }

    // Prepare payload
    const payload = { ...evt }
    if (payload.type === 'cycle_start') {
      payload.cycleNum = orderIdBase + cycleOffset - 1
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

  const pathname = url.parse(req.url).pathname
  const parsedUrl = url.parse(req.url, true)
  const query = parsedUrl.query

  if (pathname === '/api/recent-orders') {
    const orders = readOrders()
    const recent = orders.slice(-4).reverse()
    const failed = orders.filter(o => o.status === 'failed').length
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ total: orders.length, failedCount: failed, recent }))

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

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      from, to,
      days,
      totals: { delivered: totalDelivered, warning: totalWarning, failed: totalFailed, avg_fetch_seconds: avgFetch },
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

  } else {
    res.writeHead(404)
    res.end('Not found')
  }
})

const wss = new WebSocketServer({ server })

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  WebSocket: ws://0.0.0.0:${PORT}`)
  console.log(`  HTTP API:  http://0.0.0.0:${PORT}/api/recent-orders\n`)
  globalReplay()
})

wss.on('connection', (ws) => {
  console.log(`Client connected — sending ${cycleHistory.length} catch-up events`)

  for (const evt of cycleHistory) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ ...evt, _catchUp: true, _cycleStartedAt: cycleStartTime }))
    }
  }

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
