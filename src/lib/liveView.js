/**
 * View-model builders for the Live page.
 *
 * The message mapper collects facts (scores, tries, places checked, raw lines);
 * these functions turn them into the sentences, numbers and states the cards
 * display. Pure functions so they can be tested against replayed robot logs.
 */

import { PIPELINE, stepTitleForComponent } from '../services/messageMapper'
import { friendlyWaypoint, translateFault } from './logTranslate'
import { contextSentence, etaSeconds, typicalStepSeconds, itemStats } from './orderStats'

export function fmtDuration(totalSec) {
  const s = Math.max(0, Math.round(totalSec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return r > 0 ? `${m}m ${r}s` : `${m}m`
  return `${r}s`
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// ── Steps ───────────────────────────────────────────────────────────────────

const WHY = {
  searching: 'I sweep each shelf with the camera until the requested item is detected. When every place on the route is empty, the search ends and I ask for help.',
  anchor_select: 'Several detections can match the name. I pick the one with the highest match score.',
  closeup_move: 'The arm moves to a close-up viewpoint so the grasp can be measured accurately. Each blocked grasp sends it to a new viewpoint.',
  analyzing: 'I outline the item, then read its distance from the depth camera to choose where to grip.',
  grasping: 'Before the gripper moves, the planner checks the path against everything it can see. A path that would touch a neighbouring item is rejected and another grasp is tried.',
  transit: 'The arm carries the item along a planned path to the handover desk.',
  release: 'The gripper opens once the customer has taken the item.',
  returning: 'The arm goes back to its home position, ready for the next order.',
}

function spentSeconds(liveData, key, nowMs) {
  const info = liveData._stageInfo?.[key]
  if (!info) return null
  let ms = info.spent || 0
  const cur = liveData._stageCursor
  if (cur && cur.key === key && !liveData._cycleComplete) {
    const le = liveData._lastEvent
    const lastEventNow = le ? le.ts + Math.max(0, nowMs - le.seen) : cur.ts
    ms += Math.max(0, lastEventNow - cur.ts)
  } else if (cur && cur.key === key && liveData._cycleComplete && liveData._lastEvent) {
    ms += Math.max(0, liveData._lastEvent.ts - cur.ts)
  }
  return Math.round(ms / 1000)
}

function scoreRange(list) {
  if (!list.length) return null
  const v = list.map(r => r.score)
  const lo = Math.min(...v), hi = Math.max(...v)
  return lo === hi ? lo.toFixed(2) : `${lo.toFixed(2)} – ${hi.toFixed(2)}`
}

function stepDetail(key, state, liveData) {
  const ev = liveData._ev
  const item = liveData._itemName || 'the item'
  const out = { summary: '', metrics: [], attempts: null }
  if (!ev) return out
  const blocked = ev.tries.filter(t => t.result === 'blocked').length
  switch (key) {
    case 'searching': {
      const labels = ev.places.map(p => friendlyWaypoint(p.wp))
      const found = ev.places.find(p => p.found)
      if (state === 'fail' && !found) out.summary = labels.length ? `No ${item} on the ${labels.join(' or the ')}.` : `Couldn’t find ${item}.`
      else if (found) out.summary = `Found on the ${friendlyWaypoint(found.wp)}.`
      else if (labels.length) out.summary = `Looking on the ${labels[labels.length - 1]}…`
      if (ev.places.length) out.metrics.push({ k: 'Places', v: String(ev.places.length) })
      if (ev.clusters != null) out.metrics.push({ k: 'Matches', v: String(ev.clusters) })
      else if (state === 'fail') out.metrics.push({ k: 'Detections', v: '0' })
      break
    }
    case 'anchor_select':
      if (ev.anchor) {
        out.summary = `Closest match is ${Math.round(ev.anchor.dist)} cm away.`
        out.metrics.push({ k: 'Match', v: ev.anchor.score.toFixed(2) }, { k: 'Distance', v: `${Math.round(ev.anchor.dist)} cm` })
        if (ev.candidates > 1) out.metrics.push({ k: 'Candidates', v: String(ev.candidates) })
      }
      break
    case 'closeup_move':
      out.summary = ev.viewpoints > 1 ? `${plural(ev.viewpoints, 'viewpoint', 'viewpoints')} used so far.` : 'Close-up view above the item.'
      if (ev.retryMax != null) out.metrics.push({ k: 'Retries', v: `${ev.retriesUsed} of ${ev.retryMax}` })
      break
    case 'analyzing': {
      if (ev.refine.length) out.summary = 'Grasp point found.'
      const r = scoreRange(ev.refine)
      if (r) out.metrics.push({ k: 'Refine', v: r })
      if (ev.depth != null) out.metrics.push({ k: 'Depth', v: `${ev.depth.toFixed(2)} m` })
      const last = ev.refine[ev.refine.length - 1]
      if (last?.area) out.metrics.push({ k: 'Area', v: `${Math.round(last.area / 1000)}k px` })
      break
    }
    case 'grasping': {
      const running = ev.tries.find(t => t.result === 'running')
      const done = ev.tries.find(t => t.result === 'ok')
      if (done) out.summary = ev.tries.length === 1 ? 'Gripped on the first try.' : `Gripped on try ${done.n} after ${plural(blocked, 'blocked try', 'blocked tries')}.`
      else if (running) out.summary = blocked ? `Try ${running.n} is planning a path. ${plural(blocked, 'try was', 'tries were')} blocked.` : 'Reaching for the item…'
      else if (blocked) out.summary = `${plural(blocked, 'try was', 'tries were')} blocked.`
      if (ev.width != null) out.metrics.push({ k: 'Grip', v: `${ev.width} mm` })
      if (ev.tries.length) out.metrics.push({ k: 'Tries', v: String(ev.tries.length) })
      if (ev.collisions) out.metrics.push({ k: 'Collisions', v: String(ev.collisions) })
      if (ev.tries.length > 1 || blocked) {
        out.attempts = ev.tries.map(t => ({
          n: t.n,
          viewpoint: `Viewpoint ${t.viewpoint}`,
          refine: t.refine != null ? t.refine.toFixed(2) : '—',
          result: t.result === 'blocked' ? 'Blocked' : t.result === 'ok' ? 'Gripped' : 'Planning a path',
          tone: t.result === 'blocked' ? 'fail' : t.result === 'ok' ? 'ok' : 'warn',
          secs: t.endTs ? Math.max(0, Math.round((Date.parse(t.endTs) - Date.parse(t.ts)) / 1000)) : null,
        }))
      }
      break
    }
    case 'transit':
      out.summary = ev.handoverBlocked ? 'No clear path to the handover desk.' : 'Moving to the handover desk.'
      break
    case 'release':
      out.summary = 'Handing the item over.'
      break
    case 'returning':
      out.summary = 'Returning to the home position.'
      break
    default:
  }
  return out
}

/**
 * Rows for the pipeline card.
 * state: done | active | activeWarn | fail | pending
 */
export function deriveSteps(liveData, history, nowMs = Date.now()) {
  if (!liveData) return []
  if (liveData._isAnomaly) return []
  const hasInfo = !!liveData._stageInfo
  if (!hasInfo) return legacySteps(liveData.steps || [])

  const typical = typicalStepSeconds(history)
  const complete = !!liveData._cycleComplete
  const cardState = liveData._cardState
  const cycleFailed = complete && cardState === 'red'
  const { currentKey, failKeys } = resolveStages(liveData)
  const currentIdx = PIPELINE.findIndex(p => p.key === currentKey)
  const ev = liveData._ev
  const rows = []

  PIPELINE.forEach((p, idx) => {
    const info = liveData._stageInfo[p.key]
    if (p.key === 'scene_scan' && !info) return
    let state
    if (!complete) {
      if (currentIdx < 0) state = 'pending'
      else if (p.key === currentKey) state = cardState === 'red' ? 'fail' : cardState === 'orange' ? 'activeWarn' : 'active'
      else if (info) {
        // Picking up stays amber while its tries are all blocked and the robot moves to a new viewpoint
        const stuck = p.key === 'grasping' && ev && ev.tries.length > 0 && !ev.tries.some(t => t.result === 'ok')
        state = stuck ? 'activeWarn' : 'done'
      } else state = idx < currentIdx ? 'done' : 'pending'
    } else if (cycleFailed) {
      state = failKeys.includes(p.key) ? 'fail' : info ? 'done' : 'pending'
    } else {
      state = 'done'
    }

    const d = stepDetail(p.key, state, liveData)
    const secs = state === 'pending' ? null : spentSeconds(liveData, p.key, nowMs)
    const typ = typical[p.key]
    const description = liveData._stageDescs?.[p.key]
    const raw = (info?.raw || []).map(r => r.text)
    rows.push({
      key: p.key,
      title: p.title,
      state,
      summary: d.summary || (state === 'pending' ? '' : description || ''),
      metrics: d.metrics,
      attempts: d.attempts,
      secs,
      dur: secs == null ? '' : state === 'active' || state === 'activeWarn' ? `${fmtDuration(secs)} so far` : fmtDuration(secs),
      typ: typ == null ? '' : typ < 1 ? 'typical under 1s' : `typical ${fmtDuration(typ)}`,
      slow: typ != null && secs != null && secs > Math.max(typ * 1.5, typ + 5),
      why: WHY[p.key] || '',
      raw,
      timestamp: liveData.steps?.find(s => s.title === p.title)?.timestamp || '',
      badge: state === 'activeWarn' && p.key === 'searching' ? 'Looking elsewhere' : '',
      openDefault: state === 'fail' || state === 'activeWarn',
      alert: liveData.steps?.find(s => s.title === p.title)?.alert || null,
    })
  })
  return rows
}

function legacySteps(steps) {
  const MAP = { completed: 'done', warning: 'fail', failed: 'fail', active: 'active', loading: 'pending', pending: 'pending' }
  return steps.map(s => ({
    key: s.id,
    title: s.title,
    state: MAP[s.state] || 'pending',
    summary: s.description || '',
    metrics: [],
    attempts: null,
    secs: null,
    dur: '',
    typ: '',
    slow: false,
    why: '',
    raw: s.debugMessages || [],
    timestamp: s.timestamp || '',
    openDefault: false,
    alert: s.alert || null,
  }))
}

// ── Now serving ─────────────────────────────────────────────────────────────

const NEXT_BY_STAGE = {
  scene_scan: 'Next: find the item on the shelves.',
  searching: 'Next: pick the best match and move closer.',
  anchor_select: 'Next: move to a close-up viewpoint.',
  closeup_move: 'Next: measure the grasp point and the distance.',
  analyzing: 'Next: pick the item up.',
  grasping: 'Next: carry the item to the handover desk.',
  transit: 'Next: hand over to the customer, then return home.',
  release: 'Next: return to the home position.',
  returning: 'Almost done: going back to the home position.',
}

// What the robot is doing, in a sentence, per step. The mapper's explanation text
// only changes on some events, so on a healthy order this stays in step with the bar.
function greenHeadline(stageKey, item, ev) {
  const place = ev?.places?.length ? friendlyWaypoint(ev.places[ev.places.length - 1].wp) : ''
  switch (stageKey) {
    case 'searching': return place ? `Looking for the ${item} on the ${place}.` : `Looking for the ${item} on the shelves.`
    case 'anchor_select': return `Found the ${item}. Choosing the best match.`
    case 'closeup_move': return `Moving in for a closer look at the ${item}.`
    case 'analyzing': return `Measuring where to grip the ${item}.`
    case 'grasping': return `Reaching for the ${item}.`
    case 'transit': return `Picked up the ${item}. Bringing it to the handover desk.`
    case 'release': return `Handing the ${item} over.`
    case 'returning': return 'Handed over. Returning to the home position.'
    default: return ''
  }
}

/**
 * Which step the order is on (`currentKey`) and, once it has failed, which steps
 * failed for good (`failKeys`, most recent first). A failed pen order can fail
 * twice — every grasp blocked, then nothing found on a second search — and the
 * pipeline should say so, so this looks at each step's own evidence rather than
 * at the highest step reached (the robot also drives home after a failure).
 */
export function resolveStages(liveData) {
  const info = liveData._stageInfo || {}
  const ev = liveData._ev
  const cursorKey = liveData._stageCursor?.key
    ?? PIPELINE[Math.max(0, liveData._activeStageIndex ?? 0)]?.key
  const unrecovered = {
    searching: () => !!ev && ev.places.length > 0 && ev.places[ev.places.length - 1].found === false,
    grasping: () => !!ev && ev.tries.length > 0 && !ev.tries.some(t => t.result === 'ok'),
    analyzing: () => (info.analyzing?.fails || 0) > 0 && !!ev && ev.depth == null,
    transit: () => !!ev?.handoverBlocked,
    release: () => (info.release?.fails || 0) > 0,
    closeup_move: () => (info.closeup_move?.fails || 0) > 0,
    anchor_select: () => (info.anchor_select?.fails || 0) > 0,
  }
  const lastTs = (k) => Date.parse(info[k]?.lastTs) || 0
  let failKeys = Object.keys(unrecovered).filter(k => info[k] && unrecovered[k]())
  if (failKeys.length === 0) {
    // Nothing matched: blame the last step that logged a failure, else where the robot stopped
    const withFails = Object.keys(info).filter(k => info[k].fails > 0 && k !== 'returning' && k !== 'scene_scan')
    failKeys = withFails.length ? [withFails.sort((a, b) => lastTs(b) - lastTs(a))[0]] : [cursorKey === 'returning' ? 'grasping' : cursorKey].filter(Boolean)
  }
  failKeys.sort((a, b) => lastTs(b) - lastTs(a))
  return { currentKey: cursorKey, failKeys, failKey: failKeys[0] }
}

function failureKind(liveData, stage) {
  const ev = liveData._ev
  const text = (liveData.explanationText || '').toLowerCase()
  if (stage === 'searching' || /find|not found|exhausted/.test(text)) return 'search'
  if (stage === 'transit' || stage === 'release' || ev?.handoverBlocked) return 'handover'
  if (stage === 'analyzing' && /distance|depth/.test(text)) return 'depth'
  if (stage === 'grasping' || stage === 'closeup_move' || /path|reach|collision/.test(text)) return 'grasp'
  return 'other'
}

function evidenceRows(liveData, state, kind) {
  const ev = liveData._ev
  if (!ev) return []
  const rows = []
  const item = liveData._itemName || 'the item'
  const blocked = ev.tries.filter(t => t.result === 'blocked').length
  if (state === 'red' && kind === 'search') {
    const labels = ev.places.map(p => friendlyWaypoint(p.wp))
    if (ev.tries.length) rows.push({ label: 'Grasp tries', value: String(ev.tries.length), note: `${blocked} blocked, so I searched again` })
    rows.push({ label: 'Places checked', value: String(ev.places.length), note: labels.join(', ') })
    rows.push({ label: `${cap(item)} detections`, value: String(ev.places.reduce((n, p) => n + (p.found ? p.matches || 0 : 0), 0)), note: 'in the last search' })
    return rows
  }
  if ((state === 'orange' || state === 'red') && ev.tries.length) {
    rows.push({ label: 'Grasp tries', value: String(ev.tries.length), note: `${blocked} blocked${ev.tries.some(t => t.result === 'running') ? ', 1 in progress' : ''}` })
    if (ev.retryMax != null) {
      rows.push({
        label: 'Viewpoints', value: `${ev.viewpoints} of ${ev.retryMax + 1}`,
        note: ev.retriesUsed >= ev.retryMax ? 'the last allowed retry is in use' : `${ev.retryMax - ev.retriesUsed} ${ev.retryMax - ev.retriesUsed === 1 ? 'retry' : 'retries'} left`,
      })
    }
    if (ev.collisions) rows.push({ label: 'Collision warnings', value: String(ev.collisions), note: 'planned paths rejected in this order' })
    return rows
  }
  if (ev.anchor) rows.push({ label: 'Target match', value: ev.anchor.score.toFixed(2), note: `closest match, ${Math.round(ev.anchor.dist)} cm away` })
  const last = ev.refine[ev.refine.length - 1]
  if (last) {
    const bits = []
    if (last.area) bits.push(`${Math.round(last.area / 1000)}k px visible`)
    if (ev.depth != null) bits.push(`depth ${ev.depth.toFixed(2)} m`)
    rows.push({ label: 'Grasp point', value: last.score.toFixed(2), note: bits.length ? 'refine score · ' + bits.join(' · ') : 'refine score' })
  }
  if (ev.width != null) {
    rows.push({ label: 'Grip', value: `${ev.width} mm`, note: ev.tries.length <= 1 ? 'first try' : `try ${ev.tries.length}` })
  }
  return rows.slice(-3)
}

export function deriveNowServing(liveData, history, nowMs = Date.now()) {
  const item = liveData?._itemName
  const startedAt = liveData?._cycleStartedAt
  const elapsedSec = startedAt ? Math.max(0, (nowMs - startedAt) / 1000) : 0
  const isActive = !!item && !liveData?._cycleComplete
  const cardState = liveData?._cardState || 'green'
  const ev = liveData?._ev
  const waiting = !!item && !!liveData?._cycleComplete && cardState === 'red'
  const resolved = liveData && liveData._stageInfo ? resolveStages(liveData) : { currentKey: undefined, failKeys: [], failKey: undefined }
  // The step the sentences are about: where it is now, or where it gave up
  const stageKey = waiting || cardState === 'red' ? resolved.failKey : resolved.currentKey
  const kind = failureKind(liveData || {}, stageKey)

  const shown = deriveSteps(liveData, history, nowMs)
  const seg = shown.map(s => s.state)
  let phaseLabel = ''
  if (shown.length && (isActive || waiting)) {
    let idx = shown.findIndex(s => s.key === stageKey)
    if (idx < 0) idx = Math.max(0, shown.filter(s => s.state === 'done').length - 1)
    const cur = shown[idx]
    phaseLabel = waiting
      ? `Stopped at step ${idx + 1} of ${shown.length} · ${cur.title}`
      : `Step ${idx + 1} of ${shown.length} · ${cur.title}${cardState === 'orange' && ev?.tries?.length && stageKey === 'grasping' ? ` · try ${ev.tries.length}` : ''}`
  }

  // Headline
  const blocked = ev ? ev.tries.filter(t => t.result === 'blocked').length : 0
  const an = /^[aeiou]/i.test(item || '') ? 'an' : 'a'
  let headline = liveData?.explanationText || ''
  if (isActive && cardState === 'green') headline = greenHeadline(stageKey, item, ev) || headline
  if (isActive && cardState === 'orange' && stageKey === 'grasping' && blocked > 0) {
    headline = `The arm can’t find a clear path to the ${item} yet. Trying another grasp.`
  }
  if (waiting) {
    headline = {
      search: blocked > 0
        ? `I couldn’t pick up the ${item} (${plural(blocked, 'try was', 'tries were')} blocked) and then couldn’t find it again.`
        : `I couldn’t find ${an} ${item} on the shelves I can check.`,
      grasp: `I couldn’t find a clear path to the ${item}.`,
      handover: `I couldn’t get the ${item} to the handover desk.`,
      depth: `I couldn’t measure the distance to the ${item}.`,
      other: translateFault(liveData?.explanationText) || 'Something went wrong. The robot needs help.',
    }[kind]
  }

  const evidence = evidenceRows(liveData || {}, cardState === 'red' ? 'red' : cardState, kind)

  // Next / if it goes wrong
  let next = NEXT_BY_STAGE[stageKey] || ''
  let ifWrong = ''
  const left = ev?.retryMax != null ? ev.retryMax - ev.retriesUsed : 2
  if (waiting || cardState === 'red') {
    next = {
      search: `Check whether ${item} is on the top or bottom shelf. If not, it is out of stock.`,
      grasp: `Check what is next to the ${item}: a neighbouring item may be in the way.`,
      handover: 'Check that the handover desk is clear.',
      depth: `Check for glare or a shiny surface on the ${item}.`,
      other: 'Please come over and look at the robot.',
    }[kind]
    ifWrong = 'The order stays open until you choose.'
  } else if (cardState === 'orange' && stageKey === 'grasping') {
    next = left <= 0
      ? 'If this try is blocked too, I stop and ask you for help. No retries are left.'
      : `If this try is blocked I move to a new viewpoint (${plural(left, 'retry', 'retries')} left), then ask you for help.`
    ifWrong = 'Nothing is needed from you right now.'
  } else if (stageKey === 'searching') {
    ifWrong = 'If no place on the route has it, I stop and ask you for help.'
  } else if (['analyzing', 'grasping', 'closeup_move'].includes(stageKey)) {
    ifWrong = left > 0
      ? `If a grasp is blocked I move to a new viewpoint (${plural(left, 'retry', 'retries')} left), then ask you for help.`
      : 'No retries are left: if a grasp is blocked I stop and ask you for help.'
  } else if (['transit', 'release'].includes(stageKey)) {
    ifWrong = 'If the handover is blocked I stop and ask you for help.'
  }

  const context = item ? contextSentence(history, item, ev?.retriesUsed || 0) : ''

  // ETA
  let eta = { label: 'ETA', value: '--', note: '' }
  if (waiting) {
    const endedAt = liveData._cycleEndedAt
    eta = { label: 'Waiting for you', value: endedAt ? fmtDuration((nowMs - endedAt) / 1000) : '--', note: '' }
  } else if (isActive) {
    const fromHistory = etaSeconds(history, item, elapsedSec)
    const stats = itemStats(history, item)
    if (fromHistory != null) {
      eta = { label: 'ETA', value: fromHistory === 0 ? 'any moment' : `~${fmtDuration(fromHistory)}`, note: `typical for ${item}: ${fmtDuration(stats.medianSeconds)}` }
    } else {
      const f = liveData?.progress?.fraction || 0
      eta = { label: 'ETA', value: f > 0.05 ? `~${fmtDuration(Math.max(0, elapsedSec / f - elapsedSec))}` : '--', note: '' }
    }
  }

  // Issues, attributed to a step
  const issues = [...(liveData?._cycleFailures || [])].reverse().map(f => ({
    ts: f.ts,
    level: f.level,
    text: f.message,
    where: stepTitleForComponent(f.component) || (f.component === 'GRIPPER' ? 'Picking up' : f.component === 'CYCLE' ? 'Order' : ''),
  }))

  return { isActive, waiting, cardState, seg, phaseLabel, headline, evidence, next, ifWrong, context, eta, issues, kind }
}

// ── Technical details ───────────────────────────────────────────────────────

export function deriveLog(liveData, limit = 6) {
  return [...(liveData?._log || [])].reverse().slice(0, limit)
}

export { translateFault }
