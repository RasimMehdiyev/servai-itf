/**
 * Maps robot socket events into the live dashboard data shape.
 *
 * Event types from the new structured log format:
 *   init, cycle_start, object_selected, phase, gripper, motion,
 *   cycle_end, robot_status, system_event, search_progress, retry,
 *   calibration, system_state, prompt_activity, system_fault,
 *   fault_recovery, image
 *
 * This is the single file to update when the log format changes.
 */

const PIPELINE = [
  { key: 'scene_scan',    title: 'Scanning the scene',   components: ['SCENE_SCAN'] },
  { key: 'searching',     title: 'Searching for item',   components: ['SEARCH_DETECT'] },
  { key: 'anchor_select', title: 'Selecting target',     components: ['ANCHOR_SELECT'] },
  { key: 'closeup_move',  title: 'Moving closer',        components: ['CLOSEUP_MOVE'] },
  { key: 'analyzing',     title: 'Analyzing the grasp',  components: ['CLOSEUP_MOLMO', 'CLOSEUP_REFINE', 'CLOSEUP_LIFT', 'SYNTHESISE', 'VISUALISE'] },
  { key: 'grasping',      title: 'Picking up',           components: ['EXECUTE_GRASP', 'CLOSEUP_RETRY'] },
  { key: 'transit',       title: 'Bringing it over',     components: ['HANDOVER_TRANSIT', 'HANDOVER_MOVE'] },
  { key: 'release',       title: 'Handing over',         components: ['HANDOVER_RELEASE'] },
  { key: 'returning',     title: 'Returning',            components: ['HANDOVER_RETURN', 'RETURN_HOME'] },
]

// ── Friendly waypoint labels ─────────────────────────────────────────────────
const WAYPOINT_LABELS = {
  'top-shelve': 'top shelf',
  'bottom-shelve': 'bottom shelf',
  'left-shelve': 'left shelf',
  'top-corner': 'top corner',
  'bottom-corner': 'bottom corner',
  'clothes-rack': 'clothes rack',
}
function friendlyWaypoint(wp) {
  return WAYPOINT_LABELS[wp] || wp
}

// ── Valid stock items ────────────────────────────────────────────────────────
const VALID_STOCK = ['pen', 'ball', 't-shirt', 'water bottle', 'phone holder', 'towel', 'sock', 'coffee mug']
function isValidItem(name) {
  const n = (name || '').toLowerCase().trim()
  return VALID_STOCK.some(v => n.includes(v) || v.includes(n))
}

function progressFromComponent(component, status) {
  const map = {
    'SCENE_SCAN':       { milestone: 0, fraction: 0.05 },
    'SEARCH_DETECT':    { milestone: 0, fraction: 0.15 },
    'ANCHOR_SELECT':    { milestone: 0, fraction: 0.22 },
    'CLOSEUP_MOVE':     { milestone: 0, fraction: 0.30 },
    'CLOSEUP_MOLMO':    { milestone: 0, fraction: 0.36 },
    'CLOSEUP_REFINE':   { milestone: 0, fraction: 0.40 },
    'CLOSEUP_LIFT':     { milestone: 0, fraction: 0.44 },
    'SYNTHESISE':       { milestone: 0, fraction: 0.50 },
    'VISUALISE':        { milestone: 0, fraction: 0.54 },
    'EXECUTE_GRASP':    { milestone: 0, fraction: 0.58 },
    'CLOSEUP_RETRY':    { milestone: 0, fraction: 0.55 },
    'HANDOVER_TRANSIT': { milestone: 1, fraction: 0.72 },
    'HANDOVER_MOVE':    { milestone: 1, fraction: 0.80 },
    'HANDOVER_RELEASE': { milestone: 2, fraction: 0.92 },
    'HANDOVER_RETURN':  { milestone: 2, fraction: 1.0 },
    'RETURN_HOME':      { milestone: 2, fraction: 1.0 },
  }
  const prog = map[component] || { milestone: 0, fraction: 0 }
  if (component === 'EXECUTE_GRASP' && status === 'SUCCESS') {
    return { milestone: 1, fraction: 0.66 }
  }
  return prog
}

function componentIndex(component) {
  return PIPELINE.findIndex(p => p.components.includes(component))
}

function timeFromTs(ts) {
  if (!ts) return ''
  const m = ts.match(/(\d{2}:\d{2}):\d{2}/)
  return m ? m[1] : ''
}

function buildSteps(activeIndex, data, timestamp) {
  return PIPELINE.map((step, i) => {
    const isPast = i < activeIndex
    const isCurrent = i === activeIndex
    const isNext = i === activeIndex + 1

    let state = 'pending', desc = 'Waiting…', ts = 'TBD'

    if (isPast) {
      state = 'completed'
      desc = data._stageDescs?.[step.key] || step.title
      ts = data._stageTimestamps?.[step.key] || ''
    } else if (isCurrent) {
      state = data._cycleComplete ? 'completed' : 'active'
      desc = data._stageDescs?.[step.key] || step.title
      ts = timeFromTs(timestamp) || data._stageTimestamps?.[step.key] || ''
    } else if (isNext && !data._cycleComplete) {
      state = 'loading'
      desc = ''
      ts = ''
    }

    const debugMsgs = data._stageDebugMessages?.[step.key] || []
    return {
      id: `s${i + 1}`, title: step.title, description: desc, state, timestamp: ts,
      ...(debugMsgs.length > 0 ? { debugMessages: debugMsgs } : {}),
    }
  })
}

// Translate raw failure details into plain-English, lay-user-friendly messages.
function friendlyFailureMessage(event, data) {
  const { component, status } = event
  const detail = event.detail || ''
  const d = detail.toLowerCase()
  const itemName = data?._itemName || 'the item'

  if (d.includes('keyboardinterrupt') || d.includes('keyboard interrupt') || d.includes('operator abort')) {
    return 'Operator aborted the handover'
  }
  if (d.includes('search exhausted') || d.includes('not found')) {
    return `Couldn't find ${itemName} anywhere on the shelves`
  }
  if (component === 'CLOSEUP_RETRY') {
    const m = detail.match(/retry (\d+)\/(\d+)/)
    return m ? `Retrying from a different angle (attempt ${m[1]} of ${m[2]})` : 'Retrying from a different angle'
  }
  if (component === 'EXECUTE_GRASP' && status === 'FAIL') {
    if (d.includes('reachability') || d.includes('plan_grasp') || d.includes('collision')) {
      return 'Path blocked — can\'t reach the item safely'
    }
    return `Couldn't pick up ${itemName}`
  }
  if (component === 'HANDOVER_MOVE' && status === 'FAIL') {
    return 'No clear path to hand over the item'
  }
  if (component === 'CLOSEUP_LIFT' && status === 'FAIL') {
    return 'Couldn\'t measure distance to the item'
  }
  if (component === 'SEARCH_DETECT' && status === 'FAIL') {
    const wp = friendlyWaypoint(event.waypoint || data?._activeWaypoint)
    return wp ? `Not on the ${wp} — looking elsewhere` : `Couldn't spot ${itemName} here`
  }
  if (component === 'HANDOVER_RELEASE' && status === 'FAIL') {
    return 'Couldn\'t complete the handover'
  }
  if (component === 'GRIPPER') {
    return 'Gripper didn\'t respond as expected'
  }
  // Generic fallback — convert COMPONENT_NAME to "component name"
  const pretty = (component || '').toLowerCase().replace(/_/g, ' ').trim()
  return pretty ? `${pretty.charAt(0).toUpperCase()}${pretty.slice(1)} failed` : 'Something went wrong'
}

function deriveCardState(data, event) {
  const ts = event.ts || new Date().toISOString()

  if (event.type === 'gripper' && !event.success) {
    return { state: 'red', failure: { level: 'red', message: 'Gripper didn\'t respond as expected', ts, component: 'GRIPPER' } }
  }
  if (event.type === 'robot_status' && event.raw?.includes('e_stopped') && event.raw?.includes('True')) {
    return { state: 'red', failure: { level: 'red', message: 'Emergency stop activated', ts, component: 'E_STOP' } }
  }
  if (event.type === 'robot_status' && event.raw?.includes('in_error') && event.raw?.includes('True')) {
    return { state: 'red', failure: { level: 'red', message: 'Robot in error state', ts, component: 'ROBOT_ERROR' } }
  }

  if (event.type === 'phase') {
    if (event.status === 'FAIL') {
      const d = event.detail || ''
      // Operator abort (KeyboardInterrupt) → orange, not red
      if (d.includes('KeyboardInterrupt') || d.includes('keyboard interrupt') || d.includes('operator abort')) {
        return { state: 'orange', failure: { level: 'orange', message: 'Operator aborted the handover', ts, component: event.component } }
      }
      const isCritical = event.component === 'EXECUTE_GRASP' || event.component === 'HANDOVER_MOVE'
        || event.component === 'CLOSEUP_LIFT'
        || d.includes('search exhausted') || d.includes('no valid depth') || d.includes('no_valid_depth')
        || d.includes('handover failed')
      if (isCritical) {
        return { state: 'red', failure: { level: 'red', message: friendlyFailureMessage(event, data), ts, component: event.component } }
      }
      if (event.component === 'SEARCH_DETECT' && d.includes('0 detections')) {
        const wp = friendlyWaypoint(event.waypoint || data._activeWaypoint)
        const itemName = data._itemName || 'item'
        const message = wp ? `No ${itemName} at the ${wp}` : `No ${itemName} here`
        return { state: 'orange', failure: { level: 'orange', message, ts, component: event.component } }
      }
    }
    if (event.component === 'CLOSEUP_RETRY' && event.status === 'BEGIN') {
      return { state: 'orange', failure: { level: 'orange', message: friendlyFailureMessage(event, data), ts, component: event.component } }
    }
  }

  if (event.type === 'cycle_end' && event.outcome === 'FAIL') {
    return { state: 'red', failure: { level: 'red', message: friendlyFailureMessage(event, data), ts, component: 'CYCLE' } }
  }

  if (data._cardState !== 'green' && event.type === 'phase' && event.status === 'SUCCESS') {
    const idx = componentIndex(event.component)
    if (idx >= (data._activeStageIndex || 0)) return { state: 'green', failure: null }
  }

  return { state: data._cardState || 'green', failure: null }
}

// Dedupe consecutive same-message failures and cap at most recent N entries.
const MAX_CYCLE_FAILURES = 4
function appendFailure(data, failure) {
  const existing = data._cycleFailures || []
  if (!failure) return existing
  // Skip if the most recent failure has the same message/level (avoid stacking duplicates)
  const last = existing[existing.length - 1]
  if (last && last.message === failure.message && last.level === failure.level) {
    return existing
  }
  // Also collapse if the same component reports the same level — keep only the latest
  const filtered = failure.component
    ? existing.filter(f => !(f.component === failure.component && f.level === failure.level))
    : existing
  const updated = [...filtered, failure]
  return updated.slice(-MAX_CYCLE_FAILURES)
}

export function applyMessageToScenario(currentData, message) {
  if (!message) return currentData
  const data = { ...currentData }
  const { ts: timestamp, type } = message

  // ── cycle_start ───────────────────────────────────────────────────────────
  if (type === 'cycle_start') {
    return {
      ...data,
      _cycleNum: message.cycleNum,
      _cycleComplete: false,
      _stageDescs: {},
      _stageTimestamps: {},
      _stageDebugMessages: {},
      _activeStageIndex: -1,
      _cardState: 'green',
      _itemName: null,
      _cycleStartedAt: message._cycleStartedAt || Date.now(),
      _motionDuration: null,
      _cycleFailures: [],
      _retryCount: 0,
      _waypointsSearched: [],
      _activeWaypoint: null,
      progress: { fraction: 0, milestone: 0, animDuration: 0 },
      steps: [],
      attentionTitle: `Cycle ${message.cycleNum}`,
      attentionLevel: 'ok',
      explanationTitle: 'STATUS',
      explanationText: 'Starting new pick cycle…',
      activeWorkflowTitle: 'What I am doing right now',
      liveStatus: 'live',
    }
  }

  // ── object_selected ───────────────────────────────────────────────────────
  if (type === 'object_selected') {
    const name = message.objectName
    if (!isValidItem(name)) {
      return {
        ...data,
        _itemName: name,
        _isAnomaly: true,
        attentionTitle: 'Unrecognized input',
        attentionLevel: 'needs_attention',
        _cardState: 'orange',
        explanationText: `"${name}" is not a known stock item — skipping this order.`,
      }
    }
    const newData = {
      ...data,
      _itemName: name,
      _isAnomaly: false,
      _cycleStartedAt: data._cycleStartedAt || Date.now(),
      attentionTitle: name.charAt(0).toUpperCase() + name.slice(1),
      attentionLevel: 'needs_attention',
      explanationText: `Searching for ${name} on the shelves.`,
    }
    newData.steps = buildSteps(data._activeStageIndex || 0, newData, timestamp)
    return newData
  }

  // ── phase (new: replaces old 'stage' events) ─────────────────────────────
  if (type === 'phase') {
    // Ignore phase events that arrive before the first cycle has started.
    // The robot fires a startup SCENE_SCAN during boot to seed its voxel
    // map — that scan isn't a real customer order and shouldn't populate
    // the dashboard pipeline.
    if (!data._cycleNum) return data

    const stageIdx = componentIndex(message.component)
    if (stageIdx < 0) return data

    const pipelineKey = PIPELINE[stageIdx].key
    const descs = { ...(data._stageDescs || {}) }
    const timestamps = { ...(data._stageTimestamps || {}) }
    const debugMsgs = { ...(data._stageDebugMessages || {}) }

    const desc = extractPhaseDescription(message, data)
    if (desc) descs[pipelineKey] = desc
    if (timestamp) timestamps[pipelineKey] = timestamps[pipelineKey] || timeFromTs(timestamp)

    const detail = extractDetailLine(message)
    if (detail) debugMsgs[pipelineKey] = [...(debugMsgs[pipelineKey] || []), detail]

    const { state: newCardState, failure } = deriveCardState(data, message)
    const prog = progressFromComponent(message.component, message.status)

    // If we just transitioned from a warning/error state back to green, the
    // retry / recovery succeeded — drop the orange failures from the panel so
    // resolved attempts don't linger as warnings. Keep red ones around as a
    // record that something serious happened.
    const carriedFailures = (newCardState === 'green' && data._cardState !== 'green')
      ? (data._cycleFailures || []).filter(f => f.level === 'red')
      : (data._cycleFailures || [])
    const carriedData = { ...data, _cycleFailures: carriedFailures }

    const retryCount = message.component === 'CLOSEUP_RETRY' && message.status === 'BEGIN'
      ? (data._retryCount || 0) + 1
      : data._retryCount || 0

    const waypoints = [...(data._waypointsSearched || [])]
    if (message.component === 'SEARCH_DETECT' && message.waypoint && !waypoints.includes(message.waypoint)) {
      waypoints.push(message.waypoint)
    }

    // Remember the most recent waypoint we saw so SUCCESS events (which often
    // don't repeat the waypoint name in their detail) can still be rendered with
    // a friendly location.
    const activeWaypoint = message.waypoint || data._activeWaypoint || null

    const newData = {
      ...data,
      _activeStageIndex: Math.max(data._activeStageIndex || 0, stageIdx),
      _stageDescs: descs,
      _stageTimestamps: timestamps,
      _stageDebugMessages: debugMsgs,
      _cardState: newCardState,
      _cycleFailures: appendFailure(carriedData, failure),
      _retryCount: retryCount,
      _waypointsSearched: waypoints,
      _activeWaypoint: activeWaypoint,
      progress: { ...prog, animDuration: data._motionDuration || 0 },
    }

    if (message.component === 'EXECUTE_GRASP' && message.status === 'SUCCESS') {
      newData.attentionLevel = 'ok'
      newData.explanationText = `Picked up ${data._itemName || 'item'} successfully. Heading to handover.`
    }

    if (newCardState === 'green' && data._cardState !== 'green') {
      newData.attentionLevel = 'ok'
      if (message.component === 'SEARCH_DETECT') {
        const wp = friendlyWaypoint(activeWaypoint)
        newData.explanationText = wp
          ? `Found ${data._itemName || 'the item'} on the ${wp}. Moving closer…`
          : `Found ${data._itemName || 'the item'}. Moving closer…`
      } else if (message.component === 'EXECUTE_GRASP') {
        newData.explanationText = `Picked up ${data._itemName || 'item'} successfully. Heading to handover.`
      } else {
        newData.explanationText = `Back on track.`
      }
    } else if (newCardState === 'orange') {
      newData.attentionLevel = 'needs_attention'
      if (message.component === 'CLOSEUP_RETRY') {
        newData.explanationText = `Grasp failed — retrying from a different angle (attempt ${retryCount}).`
      } else {
        const wp = friendlyWaypoint(activeWaypoint)
        newData.explanationText = wp
          ? `Can't find ${data._itemName || 'the item'} on the ${wp}. Checking next location…`
          : `Can't find ${data._itemName || 'the item'} here. Checking next location…`
      }
    } else if (newCardState === 'red') {
      newData.attentionLevel = 'needs_attention'
      newData.explanationText = failure?.message || 'Something went wrong. The robot needs help.'
    }

    newData.steps = buildSteps(newData._activeStageIndex, newData, timestamp)
    return newData
  }

  // ── motion (trajectory) ───────────────────────────────────────────────────
  if (type === 'motion') {
    return {
      ...data,
      _motionDuration: message.duration,
      robotParams: {
        suggestion: `Trajectory: ${message.duration}s, ${(message.speedScale * 100).toFixed(0)}% speed`,
        params: [
          { key: 'arm', label: 'Arm', value: `Moving — ${message.duration}s`, status: 'ok' },
          { key: 'gripper', label: 'Gripper', value: data._gripperState || 'Stable', status: 'ok' },
          { key: 'planner', label: 'Planner', value: 'cuRobo', status: 'ok' },
          { key: 'speed', label: 'Speed', value: `${(message.speedScale * 100).toFixed(0)}%`, status: 'ok' },
        ],
      },
      progress: {
        ...(data.progress || {}),
        animDuration: message.duration,
      },
    }
  }

  // ── gripper ───────────────────────────────────────────────────────────────
  if (type === 'gripper') {
    const gripState = message.message || 'Unknown'
    const { state: newCardState, failure } = deriveCardState(data, message)
    return {
      ...data,
      _gripperState: gripState,
      _cardState: newCardState,
      _cycleFailures: appendFailure(data, failure),
      robotParams: {
        ...(data.robotParams || {}),
        suggestion: gripState,
        params: [
          { key: 'arm', label: 'Arm', value: data.robotParams?.params?.[0]?.value || 'Idle', status: 'ok' },
          { key: 'gripper', label: 'Gripper', value: gripState, status: message.success ? 'ok' : 'warning' },
          { key: 'planner', label: 'Planner', value: 'cuRobo', status: 'ok' },
          { key: 'speed', label: 'Speed', value: data.robotParams?.params?.[3]?.value || '75%', status: 'ok' },
        ],
      },
    }
  }

  // ── cycle_end ─────────────────────────────────────────────────────────────
  if (type === 'cycle_end') {
    if (data._isAnomaly) {
      return {
        ...data,
        _cycleComplete: true,
        _cardState: 'green',
        attentionLevel: 'ok',
        explanationText: `Skipped — "${data._itemName}" is not in stock.`,
        progress: data.progress || { fraction: 0, milestone: 0, animDuration: 0 },
      }
    }
    const isFailed = message.outcome === 'FAIL'
    const { state: newCardState, failure } = deriveCardState(data, message)

    const newData = {
      ...data,
      _cycleComplete: true,
      _cardState: isFailed ? (newCardState === 'red' ? 'red' : 'red') : 'green',
      _cycleFailures: appendFailure(data, failure),
      attentionLevel: isFailed ? 'needs_attention' : 'ok',
      explanationText: isFailed
        ? (message.detail || `Could not deliver ${data._itemName || 'item'}.`)
        : `${data._itemName || 'Item'} delivered successfully.`,
      progress: isFailed
        ? (data.progress || { fraction: 0, milestone: 0, animDuration: 0 })
        : { fraction: 1, milestone: 2, animDuration: 0 },
    }
    newData.steps = buildSteps(
      isFailed ? (data._activeStageIndex || 0) : PIPELINE.length - 1,
      newData,
      timestamp,
    )
    return newData
  }

  // ── robot_status ──────────────────────────────────────────────────────────
  if (type === 'robot_status') {
    const { state: newCardState, failure } = deriveCardState(data, message)
    if (newCardState !== data._cardState || failure) {
      return { ...data, _cardState: newCardState, _cycleFailures: appendFailure(data, failure) }
    }
  }

  // ── image ─────────────────────────────────────────────────────────────────
  if (type === 'image') {
    const images = [...(data._images || [])]
    images.push({
      imageId: message.imageId,
      description: message.description,
      camera: message.camera,
      base64: message.base64,
      ts: timestamp,
    })
    if (images.length > 20) images.shift()
    return { ...data, _images: images }
  }

  // Between-cycle states (idle, calibrating, wheel watching, wheel spun)
  // belong to "no order is being served right now". Reset failure-bearing
  // fields so the previous cycle's red/orange colour doesn't leak through.
  const interCycleReset = {
    _cardState: 'green',
    _cycleFailures: [],
    attentionLevel: 'ok',
  }

  // ── system_state (idle, calibrating — from throttled broadcasts) ─────────
  if (type === 'system_state') {
    return {
      ...data,
      ...interCycleReset,
      liveStatus: 'live',
      _systemState: message.state,
      explanationTitle: 'STATUS',
      explanationText: message.state === 'idle'
        ? 'Waiting for next task…'
        : data.explanationText,
    }
  }

  // ── calibration (system startup progress) ────────────────────────────────
  if (type === 'calibration') {
    // Don't flood the panel with technical sub-step names. Show one stable
    // "starting up" line, and only swap to "ready" when the final BRINGUP
    // SUCCESS event lands.
    const action = (message.action || '').toUpperCase()
    const isReady = action === 'BRINGUP' && message.status === 'SUCCESS'
    return {
      ...data,
      ...interCycleReset,
      liveStatus: 'live',
      _systemState: isReady ? 'ready' : 'calibrating',
      attentionTitle: isReady ? 'Ready' : 'Starting up',
      explanationTitle: 'STATUS',
      explanationText: isReady
        ? 'Robot ready — waiting for the next order.'
        : 'Starting up — bringing cameras, planner, and vision models online…',
    }
  }

  // ── wheel_spin (operator just spun the wheel) ────────────────────────────
  if (type === 'wheel_spin') {
    return {
      ...data,
      ...interCycleReset,
      liveStatus: 'live',
      _systemState: 'wheel_spinning',
      attentionTitle: 'Wheel spun',
      explanationTitle: 'STATUS',
      explanationText: 'Wheel spun — watching for a stable verdict…',
    }
  }

  // ── prompt_activity (wheel watching, re-spins, ambiguity) ────────────────
  if (type === 'prompt_activity') {
    const text = message.detail || 'watching wheel'
    const isRespin = message.kind === 'respin'
    let explanation
    if (isRespin) {
      explanation = 'Operator re-spun the wheel — watching for a stable verdict…'
    } else if (message.status === 'SKIP') {
      explanation = 'Wheel verdict unclear — please give it another spin.'
    } else {
      explanation = 'Watching the wheel for the next pick…'
    }
    return {
      ...data,
      ...interCycleReset,
      liveStatus: 'live',
      _systemState: isRespin ? 'wheel_spinning' : 'prompt',
      attentionTitle: isRespin ? 'Wheel spun' : 'Watching the wheel',
      explanationTitle: 'STATUS',
      explanationText: explanation,
    }
  }

  // ── system_fault (bridge fault, executor fault — recoverable) ────────────
  if (type === 'system_fault') {
    if (message.status === 'FAIL') {
      return {
        ...data,
        _cardState: 'orange',
        attentionLevel: 'needs_attention',
        explanationText: `Hardware fault (${message.source || 'bridge'}): ${message.detail || 'temporary'}. Auto-recovering…`,
      }
    }
    return data
  }

  // ── fault_recovery (bridge recovered from fault) ─────────────────────────
  if (type === 'fault_recovery') {
    return {
      ...data,
      _cardState: data._cardState === 'orange' ? 'green' : data._cardState,
      attentionLevel: data._cardState === 'orange' ? 'ok' : data.attentionLevel,
      explanationText: 'Fault recovered. Continuing…',
    }
  }

  return data
}

// ── Phase description extraction ─────────────────────────────────────────────

function extractPhaseDescription(msg, data) {
  const { component, status, detail } = msg

  if (component === 'SCENE_SCAN') {
    if (status === 'SUCCESS' && detail?.includes('sweep complete')) return 'Sweep complete'
    if (status === 'BEGIN') return 'Moving to scan position…'
    if (status === 'SUCCESS') return 'At scan position'
    return null
  }
  if (component === 'SEARCH_DETECT') {
    const wp = friendlyWaypoint(msg.waypoint || data?._activeWaypoint)
    if (status === 'SUCCESS') {
      const m = detail?.match(/(\d+) cluster/)
      if (wp) return m ? `Spotted ${m[1]} possible matches on the ${wp}` : `Possible matches found on the ${wp}`
      return m ? `Spotted ${m[1]} possible matches` : 'Possible matches found'
    }
    if (status === 'FAIL') return wp ? `Not on the ${wp}` : 'Not here'
    if (status === 'BEGIN') return wp ? `Looking on the ${wp}…` : 'Looking…'
    return null
  }
  if (component === 'ANCHOR_SELECT') {
    if (status === 'SUCCESS') {
      const m = detail?.match(/selected=#1\(d=([\d.]+)cm,score=([\d.]+)\)/)
      return m ? `Best match ${m[1]}cm away (${Math.round(parseFloat(m[2]) * 100)}% confidence)` : 'Target selected'
    }
    return null
  }
  if (component === 'CLOSEUP_MOVE') {
    if (status === 'SUCCESS') return 'At close-up viewpoint'
    if (status === 'BEGIN' && detail?.includes('retry')) return 'Retrying from different angle…'
    if (status === 'BEGIN') return 'Moving to close-up…'
    return null
  }
  if (component === 'CLOSEUP_MOLMO') {
    if (status === 'SUCCESS') return 'Identified grasp point'
    return null
  }
  if (component === 'CLOSEUP_REFINE') {
    if (status === 'SUCCESS') {
      const m = detail?.match(/score=([\d.]+)/)
      return m ? `Confirmed (${Math.round(parseFloat(m[1]) * 100)}% match)` : 'Object confirmed'
    }
    return null
  }
  if (component === 'CLOSEUP_LIFT') {
    if (status === 'SUCCESS') {
      const m = detail?.match(/depth_med=([\d.]+)/)
      return m ? `Measured distance: ${(parseFloat(m[1]) * 100).toFixed(0)}cm` : 'Distance measured'
    }
    if (status === 'FAIL') return 'Couldn\'t measure distance — surface may be too reflective'
    return null
  }
  if (component === 'SYNTHESISE') {
    if (status === 'SUCCESS') {
      const m = detail?.match(/width=([\d.]+) mm/)
      return m ? `Grip width: ${m[1]}mm` : 'Grasp plan ready'
    }
    return null
  }
  if (component === 'VISUALISE') {
    if (status === 'SUCCESS') return 'Visualization overlay complete'
    if (status === 'BEGIN') return 'Rendering grasp overlay…'
    return null
  }
  if (component === 'EXECUTE_GRASP') {
    if (status === 'SUCCESS') return 'Picked up successfully'
    if (status === 'FAIL') return 'Can\'t reach — path blocked by obstacle'
    if (status === 'BEGIN') return 'Reaching for the item…'
    return null
  }
  if (component === 'CLOSEUP_RETRY') {
    if (status === 'BEGIN') {
      const m = detail?.match(/retry (\d+)\/(\d+)/)
      return m ? `Retry ${m[1]}/${m[2]}` : 'Retrying…'
    }
    if (status === 'SUCCESS') return 'New viewpoint reached'
    return null
  }
  if (component === 'HANDOVER_TRANSIT') {
    if (status === 'SUCCESS') return 'At transit waypoint'
    if (status === 'BEGIN') return 'Transiting…'
    return null
  }
  if (component === 'HANDOVER_MOVE') {
    if (status === 'SUCCESS') return 'Ready to hand over'
    if (status === 'FAIL') return 'Can\'t reach handover position — path blocked'
    if (status === 'BEGIN') return 'Moving to handover…'
    return null
  }
  if (component === 'HANDOVER_RELEASE') {
    if (status === 'SUCCESS') return 'Released'
    if (status === 'BEGIN') return 'Opening gripper…'
    return null
  }
  if (component === 'HANDOVER_RETURN' || component === 'RETURN_HOME') {
    if (status === 'SUCCESS') return 'Ready'
    if (status === 'BEGIN') return 'Returning…'
    return null
  }
  return null
}

function extractDetailLine(msg) {
  const { component, status, detail } = msg
  if (!detail) return null

  if (component === 'EXECUTE_GRASP' && status === 'FAIL') return 'Obstacle in the way — can\'t reach safely'
  if (component === 'HANDOVER_MOVE' && status === 'FAIL') return 'No clear path to hand over the item'
  if (component === 'HANDOVER_RELEASE' && status === 'FAIL') {
    if (detail.includes('KeyboardInterrupt') || detail.includes('operator abort')) return 'Operator aborted the handover'
    return 'Handover release failed'
  }
  if (component === 'CLOSEUP_LIFT' && status === 'FAIL') return 'Depth sensor couldn\'t get a reading'
  if (component === 'CLOSEUP_RETRY' && status === 'BEGIN') {
    const m = detail.match(/retry (\d+)\/(\d+)/)
    return m ? `Attempt ${m[1]} of ${m[2]} — trying a different angle` : 'Trying a different angle'
  }
  if (status === 'FAIL') {
    if (detail.includes('search exhausted')) return 'Checked all locations — item not found'
    if (detail.includes('user abort') || detail.includes('user declined')) return 'Skipped by operator'
    return null
  }
  return null
}
