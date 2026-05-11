/**
 * Replay WebSocket server — replays grocery_logs.txt indistinguishably
 * from a live robot socket.
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
 * Also serves a tiny HTTP endpoint:
 *   GET /api/recent-orders  → last 4 entries from ./data/orders.json
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
const FAILURE_AFTER_CYCLE = 2   // inject a simulated failure after this cycle (per loop)
const FAILURE_PAUSE = 20000     // ms of silence before resuming (triggers client idle → red)
const INTERVENTION_TIMEOUT = 120000  // 2 minutes for employee to intervene on "item not found"
const INTERVENTION_DEMO_DELAY = 8000 // in replay mode, auto-resolve intervention after this delay
const MAX_EVENT_DELAY = 5000         // cap any single inter-event gap at 5s (before speed scaling)

// ── Failure classification ───────────────────────────────────────────────────

function classifyFailure(message) {
  const msg = (message || '').toLowerCase()
  if (msg.includes('gripper') || msg.includes('grip') || msg.includes('slipped') || msg.includes('dropped'))
    return 'Grip failure'
  if (msg.includes('detection') || msg.includes('detect'))
    return 'Item not detected'
  if (msg.includes('e_stop') || msg.includes('emergency'))
    return 'Emergency stop'
  if (msg.includes('error state'))
    return 'Robot error'
  if (msg.includes('timeout') || msg.includes('no updates'))
    return 'Connection timeout'
  return 'Unknown failure'
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

// ── Log parser ───────────────────────────────────────────────────────────────

function parseLog(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  const events = []
  let lastTimestamp = null
  let inTraceback = false

  for (const rawLine of raw) {
    const line = rawLine.replace(/\r$/, '')

    if (line.startsWith('Traceback') || line.startsWith('  File ') || line.startsWith('    ')
        || line.startsWith('^C') || line.startsWith('[interrupt]') || line.match(/^\[1\]\+/)) {
      inTraceback = true
      continue
    }
    if (inTraceback && (line.trim() === '' || line.startsWith('  '))) continue
    inTraceback = false

    if (!line.trim()) continue
    if (line.startsWith('/home/') || line.startsWith('Loading checkpoint')
        || line.match(/^\d+%\|/) || line.startsWith('(viser)')
        || line.startsWith('╭') || line.startsWith('│') || line.startsWith('╰')) continue

    if (line.trim() === 'y' || line.trim() === 'N') continue

    const robotLog = line.match(
      /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s*\|\s*(\w+)\s*\|\s*([\w.:\-]+)\s*-\s*(.*)$/
    )
    if (robotLog) {
      lastTimestamp = robotLog[1]
      const logMessage = robotLog[4].trim()

      if (logMessage.includes('Gripper result:')) {
        const m = logMessage.match(/success=(\w+), message=(.+)/)
        events.push({ ts: lastTimestamp, type: 'gripper', success: m?.[1] === 'True', message: m?.[2] || '', raw: logMessage })
      } else if (logMessage.includes('TrajectoryTarget envelope:')) {
        const dur = logMessage.match(/duration=([\d.]+)s/)
        const spd = logMessage.match(/speed_scale=([\d.]+)/)
        events.push({ ts: lastTimestamp, type: 'motion', duration: parseFloat(dur?.[1] || '0'), speedScale: parseFloat(spd?.[1] || '0.5'), raw: logMessage })
      } else if (logMessage.includes('robot status:')) {
        events.push({ ts: lastTimestamp, type: 'robot_status', raw: logMessage })
      } else {
        events.push({ ts: lastTimestamp, type: 'robot_log', raw: logMessage })
      }
      continue
    }

    const initMatch = line.match(/^\[init\] (.+)$/)
    if (initMatch) {
      events.push({ ts: lastTimestamp, type: 'init', text: initMatch[1] })
      continue
    }

    const cycleStart = line.match(/^=== Cycle (\d+) ===$/)
    if (cycleStart) {
      events.push({ ts: lastTimestamp, type: 'cycle_start', cycleNum: parseInt(cycleStart[1]) })
      continue
    }

    const objSel = line.match(/^\[cycle \d+\] object> (.+)$/)
    if (objSel) {
      events.push({ ts: lastTimestamp, type: 'object_selected', objectName: objSel[1].trim() })
      continue
    }

    if (line.match(/^\[cycle \d+\] complete\.$/)) {
      events.push({ ts: lastTimestamp, type: 'cycle_end' })
      continue
    }

    if (line.match(/^\[cycle \d+\] (known|enter)/)) continue
    if (line.match(/\] execute\? \[y\/N\]/) || line.match(/\?\s*\[y\/N\]/)) continue

    const stageMatch = line.match(/^\[stage (\d+[a-d]?)\]\s*(.*)$/)
    if (stageMatch) {
      const stageNum = stageMatch[1]
      const text = stageMatch[2].trim()
      if (text.match(/\?\s*\[y\/N\]/)) continue
      if (text.includes('aborted by user')) continue
      if (text.startsWith('waiting for employee intervention')) {
        events.push({ ts: lastTimestamp, type: 'intervention_wait', stageNum, text })
        continue
      }
      if (text.startsWith('employee intervention:')) {
        events.push({ ts: lastTimestamp, type: 'intervention_resolved', stageNum, text })
        continue
      }
      events.push({ ts: lastTimestamp, type: 'stage', stageNum, text })
      continue
    }

    const arrowStage = line.match(/^\[stage (\d+[a-d]?)\s*→\s*[^]]+?\]\s*(.*)$/)
    if (arrowStage) {
      if (arrowStage[2].match(/\?\s*\[y\/N\]/)) continue
      events.push({ ts: lastTimestamp, type: 'stage', stageNum: arrowStage[1], text: arrowStage[2].trim() })
      continue
    }
  }

  return events
}

// ── Timestamp math ───────────────────────────────────────────────────────────

function tsToMs(tsStr) {
  if (!tsStr) return null
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

let cycleHistory = []  // events sent in the current cycle — for catch-up
let currentEventIndex = 0
let loopCount = 0
let globalTimeout = null
let heartbeatTimer = null
let orderIdBase = nextOrderId()
let cycleOffset = 0
let currentItem = null
let cycleStartTime = null
let stepLog = []
let stepStart = null
let stepName = null
let cycleFailures = []
let interventionTimer = null
let interventionResolve = null  // callback to resume after intervention

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

function loadReplayState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8')
    return JSON.parse(raw)
  } catch { return null }
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

    // Track cycle bookkeeping
    if (evt.type === 'cycle_start') {
      cycleOffset++
      currentItem = null
      cycleStartTime = Date.now()
      stepLog = []
      stepStart = Date.now()
      stepName = 'Return to start'
      cycleFailures = []
      cycleHistory = []  // reset history for the new cycle
    }

    if (evt.type === 'object_selected') currentItem = evt.objectName

    if (evt.type === 'stage') {
      if (stepName && stepStart) {
        stepLog.push({ name: stepName, duration_seconds: Math.round((Date.now() - stepStart) / 1000), meta: {} })
      }
      stepStart = Date.now()
      stepName = `Stage ${evt.stageNum}`

      // Track orange-level failure: 0 detections
      if (evt.stageNum === '3') {
        const m = evt.text?.match(/(\d+) detection\(s\)/)
        if (m && parseInt(m[1]) === 0) {
          cycleFailures.push({ level: 'orange', message: `0 detections for ${currentItem || 'item'}` })
        }
      }
    }

    // Track red-level failures
    if (evt.type === 'gripper' && !evt.success) {
      cycleFailures.push({ level: 'red', message: evt.message || 'Gripper failure' })
    }
    if (evt.type === 'robot_status') {
      if (evt.raw?.includes('e_stopped') && evt.raw?.includes('True')) {
        cycleFailures.push({ level: 'red', message: 'Emergency stop activated' })
      }
      if (evt.raw?.includes('in_error') && evt.raw?.includes('True')) {
        cycleFailures.push({ level: 'red', message: 'Robot in error state' })
      }
    }

    if (evt.type === 'cycle_end' && cycleStartTime) {
      if (stepName && stepStart) {
        stepLog.push({ name: stepName, duration_seconds: Math.round((Date.now() - stepStart) / 1000), meta: {} })
      }
      const orderId = orderIdBase + cycleOffset - 1
      const hasCritical = cycleFailures.some(f => f.level === 'red')
      const status = hasCritical ? 'failed' : 'ok'
      let failureReason = null
      if (hasCritical) {
        failureReason = classifyFailure(cycleFailures.find(f => f.level === 'red').message)
      } else if (cycleFailures.some(f => f.level === 'orange')) {
        failureReason = classifyFailure(cycleFailures.find(f => f.level === 'orange').message)
      }
      const startedAt = new Date(cycleStartTime).toISOString()
      const d = new Date(cycleStartTime)
      const timestamp = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      writeOrder({
        id: orderId,
        item: currentItem || 'unknown',
        orderNumber: String(orderId),
        timestamp,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        total_seconds: Math.round((Date.now() - cycleStartTime) / 1000),
        steps: stepLog,
        status,
        failureReason,
        rating: status === 'ok' ? 5 : 1,
      })
      console.log(`  Order #${orderId} (${currentItem}) [${status}] written to orders.json`)
    }

    const payload = { ...evt }
    if (payload.type === 'cycle_start') {
      payload.cycleNum = orderIdBase + cycleOffset - 1
    }

    cycleHistory.push(payload)
    broadcast(payload)
    saveReplayState()

    // When we hit an intervention_wait, pause replay and wait for employee or timeout
    if (evt.type === 'intervention_wait') {
      console.log(`  Intervention required — waiting up to ${INTERVENTION_TIMEOUT / 1000}s for employee action…`)
      startHeartbeat()

      // Find the intervention_resolved event that follows (it's the next event in the log)
      const resolvedIdx = allEvents.findIndex((e, i) => i > idx && e.type === 'intervention_resolved')

      interventionResolve = (fromEmployee) => {
        interventionResolve = null
        if (interventionTimer) { clearTimeout(interventionTimer); interventionTimer = null }

        if (fromEmployee && resolvedIdx !== -1) {
          // Employee intervened — continue from the resolved event onward
          console.log('  Employee intervened — resuming pipeline')
          const resumeEvt = allEvents[resolvedIdx]
          cycleHistory.push(resumeEvt)
          broadcast(resumeEvt)
          const nextIdx = resolvedIdx + 1
          const nextDelay = nextIdx < delays.length ? delays[nextIdx] : 50
          globalTimeout = setTimeout(() => sendEvent(nextIdx), nextDelay)
        } else {
          // Timeout — skip rest of this cycle, emit a cycle_end as failed
          console.log('  No intervention — skipping cycle (timeout)')
          const skipEvt = {
            ts: new Date().toISOString(),
            type: 'stage',
            stageNum: '3',
            text: 'Intervention timeout — skipping to next order',
          }
          cycleHistory.push(skipEvt)
          broadcast(skipEvt)

          // Write a failed order for this cycle
          if (stepName && stepStart) {
            stepLog.push({ name: stepName, duration_seconds: Math.round((Date.now() - stepStart) / 1000), meta: {} })
          }
          const orderId = orderIdBase + cycleOffset - 1
          const startedAt = new Date(cycleStartTime).toISOString()
          const d = new Date(cycleStartTime)
          const timestamp = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          writeOrder({
            id: orderId,
            item: currentItem || 'unknown',
            orderNumber: String(orderId),
            timestamp,
            started_at: startedAt,
            completed_at: new Date().toISOString(),
            total_seconds: Math.round((Date.now() - cycleStartTime) / 1000),
            steps: stepLog,
            status: 'failed',
            failureReason: 'Item not detected',
            rating: 1,
          })
          console.log(`  Order #${orderId} (${currentItem}) [failed — timeout] written to orders.json`)

          const endEvt = { ts: new Date().toISOString(), type: 'cycle_end' }
          cycleHistory.push(endEvt)
          broadcast(endEvt)

          // Skip ahead to the next cycle_start in the log
          let nextCycleIdx = allEvents.findIndex((e, i) => i > idx && e.type === 'cycle_start')
          if (nextCycleIdx === -1) {
            // No more cycles — end of loop
            stopHeartbeat()
            globalTimeout = setTimeout(globalReplay, LOOP_PAUSE / REPLAY_SPEED)
          } else {
            const nextDelay = 1000 / REPLAY_SPEED
            globalTimeout = setTimeout(() => sendEvent(nextCycleIdx), nextDelay)
          }
        }
      }

      // In replay mode, auto-resolve after a short demo delay (employee can still intervene earlier)
      interventionTimer = setTimeout(() => {
        if (interventionResolve) {
          console.log('  Auto-resolving intervention (demo mode)')
          interventionResolve(true)
        }
      }, INTERVENTION_DEMO_DELAY / REPLAY_SPEED)

      return
    }

    // Skip the intervention_resolved event during normal replay (handled by intervention logic)
    if (evt.type === 'intervention_resolved') {
      const nextDelay = (idx + 1 < delays.length) ? delays[idx + 1] : 50
      globalTimeout = setTimeout(() => sendEvent(idx + 1), nextDelay)
      return
    }

    // After the target cycle, pause without heartbeats to trigger client-side idle → red
    if (evt.type === 'cycle_end' && cycleOffset === FAILURE_AFTER_CYCLE) {
      stopHeartbeat()
      console.log(`  Simulating failure: ${FAILURE_PAUSE / 1000}s silence after cycle ${cycleOffset}…`)
      globalTimeout = setTimeout(() => {
        const failTs = new Date().toISOString()
        // Send a gripper failure to explicitly trigger red state with context
        const failEvt = {
          ts: failTs,
          type: 'gripper',
          success: false,
          message: 'Gripper timeout — object slipped during grasp',
          raw: 'Gripper result: success=False, message=Gripper timeout — object slipped during grasp',
        }
        cycleHistory.push(failEvt)
        broadcast(failEvt)

        // Persist the simulated failure as an order
        const failOrderId = nextOrderId()
        const d = new Date()
        writeOrder({
          id: failOrderId,
          item: currentItem || 'unknown',
          orderNumber: String(failOrderId),
          timestamp: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
          started_at: failTs,
          completed_at: failTs,
          total_seconds: Math.round(FAILURE_PAUSE / 1000),
          steps: [],
          status: 'failed',
          failureReason: 'Grip failure',
          rating: 1,
        })
        console.log(`  Order #${failOrderId} (${currentItem}) [failed — grip failure] written to orders.json`)

        startHeartbeat()
        // Continue replay
        const nextDelay = (idx + 1 < delays.length) ? delays[idx + 1] : 50
        globalTimeout = setTimeout(() => sendEvent(idx + 1), nextDelay)
      }, FAILURE_PAUSE / REPLAY_SPEED)
      return
    }

    // Restart heartbeat timer from each real event
    startHeartbeat()

    const nextDelay = (idx + 1 < delays.length) ? delays[idx + 1] : 50
    globalTimeout = setTimeout(() => sendEvent(idx + 1), nextDelay)
  }

  sendEvent(0)
}

// ── HTTP + WebSocket server ──────────────────────────────────────────────────

const url = require('url')

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const pathname = url.parse(req.url).pathname
  if (pathname === '/api/recent-orders') {
    const orders = readOrders()
    const recent = orders.slice(-4).reverse()
    const failed = orders.filter(o => o.status === 'failed').length
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ total: orders.length, failedCount: failed, recent }))
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

server.listen(PORT, () => {
  console.log(`\n  WebSocket: ws://localhost:${PORT}`)
  console.log(`  HTTP API:  http://localhost:${PORT}/api/recent-orders\n`)
  globalReplay()
})

wss.on('connection', (ws) => {
  console.log(`Client connected — sending ${cycleHistory.length} catch-up events`)

  // Send all events from the current cycle as a rapid burst so the client
  // rebuilds the exact current state
  for (const evt of cycleHistory) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ ...evt, _catchUp: true, _cycleStartedAt: cycleStartTime }))
    }
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw)
      if (msg.type === 'intervene' && interventionResolve) {
        interventionResolve(true)
      }
    } catch {}
  })

  ws.on('close', () => console.log('Client disconnected'))
})
