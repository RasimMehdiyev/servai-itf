/**
 * Maps robot socket events into the live dashboard data shape.
 *
 * Event types from the socket:
 *   init, cycle_start, object_selected, stage, gripper, motion,
 *   cycle_end, robot_status, robot_log, shutdown
 *
 * This is the single file to update when the log format changes.
 */

const PIPELINE = [
  { key: 'stage1',  title: 'Return to start',        stageNums: ['1'] },
  { key: 'stage2',  title: 'Object selected',         stageNums: ['2'] },
  { key: 'stage3',  title: 'Detecting object',        stageNums: ['3'] },
  { key: 'stage4',  title: 'Anchor selection',         stageNums: ['4'] },
  { key: 'stage5',  title: 'Moving to viewpoint',     stageNums: ['5'] },
  { key: 'stage6',  title: 'Grasp point detection',   stageNums: ['6'] },
  { key: 'stage7',  title: 'Close-up segmentation',   stageNums: ['7'] },
  { key: 'stage8',  title: 'Depth estimation',        stageNums: ['8'] },
  { key: 'stage9',  title: 'Grasp synthesis',          stageNums: ['9'] },
  { key: 'stage11', title: 'Executing grasp',          stageNums: ['11'] },
  { key: 'stage12', title: 'Handover & return',        stageNums: ['12a','12b','12c','12d'] },
]

// Progress milestones: 0 = Started, 1 = Picked up, 2 = Handover
// Stages up to 5 → before milestone 0 (finding item)
// Stages 6–9 → between 0 and 1 (picking)
// Stage 11 SUCCESS → milestone 1 (picked up)
// Stage 12b arrived → milestone 2 (handover)
function progressFromStage(stageNum, text) {
  const n = parseInt(stageNum)
  if (n <= 5) return { milestone: 0, fraction: Math.min(n / 5, 1) * 0.33 }
  if (n <= 9) return { milestone: 0, fraction: 0.33 + ((n - 5) / 4) * 0.33 }
  if (stageNum === '11') {
    if (text?.includes('SUCCESS')) return { milestone: 1, fraction: 0.66 }
    return { milestone: 0, fraction: 0.60 }
  }
  if (stageNum === '12a') return { milestone: 1, fraction: 0.72 }
  if (stageNum === '12b') {
    if (text?.includes('arrived')) return { milestone: 2, fraction: 0.90 }
    return { milestone: 1, fraction: 0.80 }
  }
  if (stageNum === '12c') return { milestone: 2, fraction: 0.95 }
  if (stageNum === '12d') return { milestone: 2, fraction: 1.0 }
  return { milestone: 0, fraction: 0 }
}

function stageIndexForNum(sn) {
  return PIPELINE.findIndex(p => p.stageNums.includes(sn))
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

/**
 * Determine card state and optionally a failure record.
 * Returns { state, failure } where failure is null or { level, message, ts }.
 */
function deriveCardState(data, event) {
  const ts = event.ts || new Date().toISOString()

  // Red triggers
  if (event.type === 'gripper' && !event.success) {
    return { state: 'red', failure: { level: 'red', message: event.message || 'Gripper failure', ts } }
  }
  if (event.type === 'robot_status' && event.raw?.includes('e_stopped') && event.raw?.includes('True')) {
    return { state: 'red', failure: { level: 'red', message: 'Emergency stop activated', ts } }
  }
  if (event.type === 'robot_status' && event.raw?.includes('in_error') && event.raw?.includes('True')) {
    return { state: 'red', failure: { level: 'red', message: 'Robot in error state', ts } }
  }

  // Orange trigger: stage 3 with 0 detections
  if (event.type === 'stage' && event.stageNum === '3') {
    const m = event.text?.match(/(\d+) detection\(s\)/)
    if (m && parseInt(m[1]) === 0) {
      return { state: 'orange', failure: { level: 'orange', message: `0 detections for ${data._itemName || 'item'}`, ts } }
    }
  }

  // If currently non-green but pipeline resumed successfully → green
  if (data._cardState !== 'green' && event.type === 'stage') {
    const idx = stageIndexForNum(event.stageNum)
    if (idx > (data._activeStageIndex || 0)) return { state: 'green', failure: null }
  }

  return { state: data._cardState || 'green', failure: null }
}

function appendFailure(data, failure) {
  if (!failure) return data._cycleFailures || []
  return [...(data._cycleFailures || []), failure]
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
    const stageIdx = stageIndexForNum('2')
    const descs = { ...(data._stageDescs || {}), stage2: name }
    const timestamps = { ...(data._stageTimestamps || {}), stage2: timeFromTs(timestamp) }

    const newData = {
      ...data,
      _itemName: name,
      _activeStageIndex: stageIdx,
      _stageDescs: descs,
      _stageTimestamps: timestamps,
      _cycleStartedAt: data._cycleStartedAt || Date.now(),
      attentionTitle: name.charAt(0).toUpperCase() + name.slice(1),
      attentionLevel: 'needs_attention',
      explanationText: `Fetching ${name} from the shelf.`,
    }
    newData.steps = buildSteps(stageIdx, newData, timestamp)
    return newData
  }

  // ── stage ─────────────────────────────────────────────────────────────────
  if (type === 'stage') {
    const stageIdx = stageIndexForNum(message.stageNum)
    if (stageIdx < 0) return data

    const pipelineKey = PIPELINE[stageIdx].key
    const descs = { ...(data._stageDescs || {}) }
    const timestamps = { ...(data._stageTimestamps || {}) }
    const debugMsgs = { ...(data._stageDebugMessages || {}) }

    const desc = extractStageDescription(message.stageNum, message.text, data)
    if (desc) descs[pipelineKey] = desc
    if (timestamp) timestamps[pipelineKey] = timestamps[pipelineKey] || timeFromTs(timestamp)

    const detail = extractDetailLine(message.stageNum, message.text)
    if (detail) debugMsgs[pipelineKey] = [...(debugMsgs[pipelineKey] || []), detail]

    const { state: newCardState, failure } = deriveCardState(data, message)
    const prog = progressFromStage(message.stageNum, message.text)

    const newData = {
      ...data,
      _activeStageIndex: Math.max(data._activeStageIndex || 0, stageIdx),
      _stageDescs: descs,
      _stageTimestamps: timestamps,
      _stageDebugMessages: debugMsgs,
      _cardState: newCardState,
      _cycleFailures: appendFailure(data, failure),
      progress: { ...prog, animDuration: data._motionDuration || 0 },
    }

    if (message.text?.includes('SUCCESS')) {
      newData.attentionLevel = 'ok'
      newData.explanationText = `Picked up ${data._itemName || 'item'} successfully. Heading to handover.`
    }

    if (newCardState === 'orange') {
      newData.attentionLevel = 'needs_attention'
      newData.explanationText = `Can't find ${data._itemName || 'the item'} on the shelf. It may need restocking.`
    }
    if (newCardState === 'red') {
      newData.attentionLevel = 'needs_attention'
      newData.explanationText = `Something went wrong. The robot needs help.`
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
          { key: 'speed', label: 'Speed', value: data.robotParams?.params?.[3]?.value || '50%', status: 'ok' },
        ],
      },
    }
  }

  // ── cycle_end ─────────────────────────────────────────────────────────────
  if (type === 'cycle_end') {
    const newData = {
      ...data,
      _cycleComplete: true,
      _cardState: 'green',
      attentionLevel: 'ok',
      explanationText: `${data._itemName || 'Item'} delivered successfully.`,
      progress: { fraction: 1, milestone: 2, animDuration: 0 },
    }
    newData.steps = buildSteps(PIPELINE.length - 1, newData, timestamp)
    return newData
  }

  // ── robot_status ──────────────────────────────────────────────────────────
  if (type === 'robot_status') {
    const { state: newCardState, failure } = deriveCardState(data, message)
    if (newCardState !== data._cardState || failure) {
      return { ...data, _cardState: newCardState, _cycleFailures: appendFailure(data, failure) }
    }
  }

  return data
}

// ── Stage description extraction ─────────────────────────────────────────────

function extractStageDescription(stageNum, text) {
  switch (stageNum) {
    case '1':  { const m = text?.match(/planning to '(.+?)'/); return m ? `Returning to ${m[1]}` : 'Returning to start' }
    case '3':  { const m = text?.match(/(\d+) detection\(s\) in ([\d.]+)s/); return m ? `${m[1]} detections in ${m[2]}s` : null }
    case '4':  { const m = text?.match(/anchor mode='(\w+)', selected=#(\d+)\(d=([\d.]+)cm/); return m ? `Anchor #${m[2]} (${m[3]}cm)` : null }
    case '5':  { if (text?.includes('arrived')) return 'At viewpoint'; return null }
    case '6':  { const m = text?.match(/selected Molmo point: \((.+?)\)/); return m ? `Grasp pixel: (${m[1]})` : null }
    case '7':  { const m = text?.match(/score=([\d.]+) area=(\d+)px/); return m ? `Score=${m[1]}, ${m[2]}px` : null }
    case '8':  { const m = text?.match(/depth_med=([\d.]+)/); return m ? `Depth: ${m[1]}m` : null }
    case '9':  { const m = text?.match(/width=([\d.]+) mm/); return m ? `Width=${m[1]}mm` : null }
    case '11': { if (text?.includes('SUCCESS')) return 'Grasp successful'; const m = text?.match(/pre-grasp opening: (\w+)/); return m ? `Opening: ${m[1]}` : null }
    case '12a': return text?.includes('arrived') ? 'At transit waypoint' : 'Transiting…'
    case '12b': return text?.includes('arrived') ? 'At handover' : 'Moving to handover…'
    case '12c': return text?.includes('opened') ? 'Released' : 'Releasing…'
    case '12d': return text?.includes('returned') ? 'Ready' : 'Returning…'
    default: return null
  }
}

function extractDetailLine(stageNum, text) {
  if (stageNum === '3' && text?.match(/^\s*#\d+ score=/)) return text.trim()
  if (stageNum === '4' && text?.match(/^\s*#\d+: centroid=/)) return text.trim()
  if (stageNum === '4' && text?.includes('anchor mode=')) return text.trim()
  if (stageNum === '9' && (text?.includes('depth_offset') || text?.includes('degenerate_pca'))) return text.trim()
  if (stageNum === '11' && (text?.includes('driving grasp') || text?.includes('grasp width') || text?.includes('SUCCESS'))) return text.trim()
  return null
}
