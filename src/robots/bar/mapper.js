/**
 * Maps the bartender's socket events into the live dashboard data shape — the bar's counterpart
 * of services/messageMapper.js. The data keeps the same field names (steps' siblings _cardState,
 * _cycleFailures, _stageInfo, _log …) so the Live cards read either robot the same way.
 *
 * Events arrive already normalised by the relay (src/robots/serverProfile.cjs):
 *   cycle_start, object_selected, phase (DECAP, SHAKE, TRACK, POUR_BEGIN, GLASS_DETECT, BOTTLE_GRAB,
 *   POUR_MOVE, GLASS, BOTTLE_RETURN, BOTTLE, POUR_DONE), gripper, rack_scan, calibration, cycle_end.
 */

import { BAR_PIPELINE, barStageIndex, barStageTitle } from './pipeline'
import { translateBarEvent, translateBarFault } from './translate'
import { rawText } from '../../lib/logTranslate'
import { fmtLitres } from '../../lib/format'
import { applyCritic, newCritic } from '../../lib/critic'

export const barInitialState = {
  _robot: 'bar',
  storeId: 'Barista',
  liveStatus: 'live',
  orderId: '',
  attentionTitle: 'Waiting for the first drink…',
  attentionLevel: 'ok',
  explanationTitle: 'STATUS',
  explanationText: 'The bar is connected and ready. It starts when the next drink cycle begins.',
  explanationBullets: [],
  validation: null,
  resolutionActions: [],
  robotParams: null,
  activeWorkflowTitle: 'What I am doing right now',
  earlierStepsCount: 0,
  steps: [],
  _cardState: 'green',
  _cycleStartedAt: null,
  progress: { fraction: 0, milestone: 0, animDuration: 0 },
}

export function newBarEvidence(rack) {
  return {
    bottle: null,          // 0-based bottle index in the rack
    rackBottles: rack ? rack.bottles : null,
    rackCapped: rack ? rack.capped : null,
    glasses: null,
    glassesFilled: 0,
    poured: null,
    customer: false,
    decapSkipped: false,
    shakeUnsafe: false,
    refillNeeded: false,
  }
}

const MAX_LOG_ROWS = 40
const MAX_CYCLE_FAILURES = 4

function addFailure(list, failure) {
  const last = list[list.length - 1]
  if (last && last.message === failure.message && last.level === failure.level) return list
  return [...list, failure].slice(-MAX_CYCLE_FAILURES)
}

function trackBarEvidence(prev, msg) {
  const ev = { ...prev }
  const detail = msg.detail || ''
  const hole = detail.match(/rack_hole_\d+_(\d+)/)
  if (hole && ev.bottle == null) ev.bottle = parseInt(hole[1], 10)
  const sb = detail.match(/bottle (\d+)\)/)
  if (sb && ev.bottle == null) ev.bottle = parseInt(sb[1], 10)

  if (msg.component === 'DECAP' && msg.status === 'SKIP') ev.decapSkipped = true
  if (msg.component === 'SHAKE' && msg.status === 'FAIL') ev.shakeUnsafe = true
  if (msg.component === 'TRACK' && msg.status !== 'SKIP') ev.customer = true
  if (msg.component === 'GLASS_DETECT') {
    const n = detail.match(/(\d+) glass/)
    if (n) ev.glasses = parseInt(n[1], 10)
  }
  if (msg.component === 'GLASS') {
    const f = detail.match(/glass (\d+)\/(\d+) filled/)
    if (f) { ev.glassesFilled = parseInt(f[1], 10); ev.glasses = parseInt(f[2], 10) }
  }
  if (msg.component === 'BOTTLE' && msg.status === 'FAIL') ev.refillNeeded = /no bottles available|refill/i.test(detail) || ev.refillNeeded
  if (msg.component === 'POUR_DONE') {
    const p = detail.match(/poured ([\d.]+)/)
    if (p) ev.poured = parseFloat(p[1])
  }
  return ev
}

function trackBarStage(info, cursor, msg) {
  const idx = barStageIndex(msg.component)
  if (idx < 0) return { info, cursor }
  const key = BAR_PIPELINE[idx].key
  const tsMs = Date.parse(msg.ts)
  const valid = Number.isFinite(tsMs)
  const next = { ...info }
  if (cursor && cursor.key !== key && valid && next[cursor.key]) {
    next[cursor.key] = { ...next[cursor.key], spent: (next[cursor.key].spent || 0) + Math.max(0, tsMs - cursor.ts) }
  }
  const cur = next[key] || { key, firstTs: msg.ts, lastTs: msg.ts, raw: [], fails: 0, spent: 0 }
  next[key] = {
    ...cur,
    lastTs: msg.ts || cur.lastTs,
    raw: [...cur.raw, { ts: msg.ts, text: rawText(msg) }].slice(-10),
    fails: cur.fails + (msg.status === 'FAIL' ? 1 : 0),
  }
  const nextCursor = !cursor || cursor.key !== key ? { key, ts: valid ? tsMs : (cursor?.ts ?? 0) } : cursor
  return { info: next, cursor: nextCursor }
}

export function applyBarMessage(currentData, message) {
  if (!message) return currentData
  const data = { ...currentData }
  const { type, ts } = message
  const tsMs = Date.parse(ts)

  // The AI Judge (the vision-language model that rules on shaking a bottle) has its own state
  if (type === 'critic') return applyCritic(data, message)

  // ── a new drink ───────────────────────────────────────────────────────────
  if (type === 'cycle_start') {
    // The next drink starts in the same instant the last one ends, so "the rack is empty" would never be
    // seen if it only lived in one drink. It stays until a drink finishes with a bottle left to pick up.
    const carry = !!data._refillNeeded
    return {
      ...data,
      _cycleNum: message.cycleNum,
      _cycleComplete: false,
      _cardState: carry ? 'orange' : 'green',
      _itemName: null,
      _cycleStartedAt: message._cycleStartedAt || Date.now(),
      _cycleFailures: carry
        ? [{ level: 'orange', message: 'The rack was out of bottles after the last drink. Please refill it.', ts: message.ts, component: 'CARRY' }]
        : [],
      _stageDescs: {},
      _stageInfo: {},
      _stageCursor: null,
      _lastEvent: null,
      _cycleEndedAt: null,
      _cycleOutcome: null,
      _activeStageIndex: -1,
      _ev: newBarEvidence(data._rack),
      _critic: newCritic(data._critic),
      _log: [],
      _isAnomaly: false,
      steps: [],
      progress: { fraction: 0, milestone: 0, animDuration: 0 },
      attentionTitle: `Drink ${message.cycleNum}`,
      attentionLevel: 'ok',
      explanationTitle: 'STATUS',
      explanationText: 'Starting a new drink…',
      activeWorkflowTitle: 'What I am doing right now',
      liveStatus: 'live',
    }
  }

  if (type === 'object_selected') {
    return { ...data, _itemName: message.objectName || 'bottle', attentionTitle: 'Drink', explanationText: 'Getting a drink ready.' }
  }

  if (type === 'rack_scan') {
    return { ...data, _rack: { bottles: message.bottles, capped: message.capped } }
  }

  if (type === 'calibration') {
    const ready = (message.action || '').toUpperCase() === 'BRINGUP' && message.status === 'SUCCESS'
    return {
      ...data,
      _cardState: 'green',
      _cycleFailures: [],
      attentionLevel: 'ok',
      _systemState: ready ? 'ready' : 'calibrating',
      attentionTitle: ready ? 'Ready' : 'Starting up',
      explanationTitle: 'STATUS',
      explanationText: ready ? 'The bar is ready. Waiting for the next drink.' : 'Starting up — setting up the arm, cameras and vision model…',
    }
  }

  if (type === 'image') {
    const images = [...(data._images || []), { imageId: message.imageId, description: message.description, camera: message.camera, base64: message.base64, ts }]
    if (images.length > 20) images.shift()
    return { ...data, _images: images }
  }

  // everything below belongs to a drink in progress
  if (!data._cycleNum) return data

  let ev = data._ev || newBarEvidence(data._rack)
  let info = data._stageInfo || {}
  let cursor = data._stageCursor || null
  let log = data._log || []
  let failures = data._cycleFailures || []
  let cardState = data._cardState
  let explanationText = data.explanationText
  let activeIdx = data._activeStageIndex ?? -1
  let progress = data.progress
  let extra = {}

  if (type === 'phase') {
    const idx = barStageIndex(message.component)
    if (idx < 0) return data
    ev = trackBarEvidence(ev, message)
    const t = trackBarStage(info, cursor, message)
    info = t.info
    cursor = t.cursor
    activeIdx = Math.max(activeIdx, idx)
    progress = { fraction: Math.min(0.97, (idx + 1) / BAR_PIPELINE.length), milestone: idx < 3 ? 0 : idx < 5 ? 1 : 2, animDuration: 0 }

    if (message.status === 'FAIL') {
      if (message.component === 'BOTTLE') {
        failures = addFailure(failures, { level: 'red', message: translateBarFault(message.detail) || 'Could not pick up a bottle', ts, component: 'BOTTLE' })
        cardState = 'red'
      } else if (message.component === 'GLASS_DETECT' || message.component === 'GLASS') {
        failures = addFailure(failures, { level: 'red', message: translateBarFault(message.detail) || 'No glass found', ts, component: message.component })
        cardState = 'red'
      } else if (message.component === 'SHAKE') {
        // informational: the shake is skipped and the drink carries on
        failures = addFailure(failures, { level: 'orange', message: translateBarFault(message.detail) || 'Not safe to shake', ts, component: 'SHAKE' })
      } else {
        failures = addFailure(failures, { level: 'orange', message: message.detail || `${message.component} failed`, ts, component: message.component })
        if (cardState !== 'red') cardState = 'orange'
      }
    }
    extra = { _stageDescs: { ...(data._stageDescs || {}), [BAR_PIPELINE[idx].key]: barStageTitle(message.component) } }
  }

  if (type === 'gripper') {
    const state = message.message || 'Gripper'
    if (!message.success) {
      failures = addFailure(failures, { level: 'red', message: 'The gripper did not respond as expected', ts, component: 'GRIPPER' })
      cardState = 'red'
    }
    extra = {
      _gripperState: state,
      robotParams: {
        suggestion: state,
        params: [
          { key: 'arm', label: 'Arm', value: data.robotParams?.params?.[0]?.value || (data._cycleComplete ? 'Idle' : 'Working'), status: 'ok' },
          { key: 'gripper', label: 'Gripper', value: state, status: message.success ? 'ok' : 'warning' },
        ],
      },
    }
  }

  if (type === 'cycle_end') {
    const failed = message.outcome === 'FAIL'
    const refill = !failed && ev.refillNeeded
    if (failed) {
      cardState = 'red'
      failures = addFailure(failures, { level: 'red', message: translateBarFault(message.detail) || message.detail || 'The drink could not be finished', ts, component: 'CYCLE' })
      explanationText = translateBarFault(message.detail) || message.detail || 'The drink could not be finished.'
    } else if (refill) {
      cardState = 'red'
      explanationText = `The drink is poured${ev.poured != null ? ` (${fmtLitres(ev.poured)})` : ''}, but the rack is out of bottles. Please refill it.`
    } else {
      cardState = 'green'
      explanationText = 'Drink finished.'
    }
    progress = failed ? progress : { fraction: 1, milestone: 2, animDuration: 0 }
    extra = { _cycleComplete: true, _cycleOutcome: message.outcome, _cycleEndedAt: Date.now(), _refillNeeded: failed ? !!data._refillNeeded : refill, attentionLevel: failed || refill ? 'needs_attention' : 'ok' }
  }

  // plain-words log row
  const tr = translateBarEvent(message)
  if (tr) {
    const last = log[log.length - 1]
    if (!last || last.plain !== tr.plain || last.ts !== ts) {
      log = [...log, { ts, raw: rawText(message), plain: tr.plain, tone: tr.tone }].slice(-MAX_LOG_ROWS)
    }
  }

  return {
    ...data,
    ...extra,
    _ev: ev,
    _stageInfo: info,
    _stageCursor: cursor,
    _lastEvent: Number.isFinite(tsMs) ? { ts: tsMs, seen: Date.now() } : data._lastEvent,
    _log: log,
    _cycleFailures: failures,
    _cardState: cardState,
    _activeStageIndex: activeIdx,
    explanationText: extra.explanationText ?? explanationText,
    progress,
  }
}
