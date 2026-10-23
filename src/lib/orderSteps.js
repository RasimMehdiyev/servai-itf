/**
 * Step rows for a saved order (History) — the same shape the Live pipeline uses,
 * so both screens render through components/ui/StepList.jsx.
 *
 * A saved order lists its steps in the order they happened, and a step can repeat
 * (every blocked grasp sends the robot back to "Moving closer"), so the steps are
 * folded per pipeline stage: time is summed, scores shown as a range, and the
 * repeated grasps become the "Grasp tries" table.
 */

import { PIPELINE } from '../services/messageMapper'
import { friendlyWaypoint, translateFault } from './logTranslate'
import { PHASE_TO_STEP, typicalStepSeconds, isDelivered } from './orderStats'
import { WHY, fmtDuration, handoverText } from './liveView'
import { deriveBarOrderSteps, barOrderHeadline } from '../robots/bar/orderSteps'
import { orderCriticView, judgeNote, JUDGE_NAME } from './critic'
import { describeAttempts } from './attempts'

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

function scoreRange(values) {
  const v = values.filter(x => typeof x === 'number')
  if (!v.length) return null
  const lo = Math.min(...v), hi = Math.max(...v)
  return lo === hi ? lo.toFixed(2) : `${lo.toFixed(2)} – ${hi.toFixed(2)}`
}

/** meta {a: 1, b: 2} → "a=1 b=2" — what an engineer would grep for. */
function metaLine(phase, meta) {
  const parts = Object.entries(meta || {})
    .filter(([k]) => k !== 'raw_event_count')
    .map(([k, v]) => `${k}=${v}`)
  return parts.length ? `${phase} ${parts.join(' ')}` : null
}

const isBad = (s) => s.status === 'warning' || s.status === 'failed'

/**
 * @param order   one order from /api/orders/list (steps are in `phases`) or from orders.json (`steps`)
 * @param history all saved orders (for typical times); optional
 * @returns rows for StepList: { key, title, state, summary, metrics, attempts, secs, dur, typ, slow, why, raw, badge, openDefault }
 */
export function deriveOrderSteps(order, history = []) {
  if (order?.robot === 'bar') return deriveBarOrderSteps(order, history)
  const saved = order?.phases || order?.steps || []
  const typical = typicalStepSeconds(history)
  const item = order?.item || 'the item'
  const failed = order?.status === 'failed'
  const judge = orderCriticView(order)
  const told = describeAttempts(order?.run_details, item)
  const tries = told && (told.rows.length > 1 || told.failedSoFar) ? told : null

  // fold the saved steps per pipeline stage, keeping their order of appearance
  const byKey = {}
  const seq = []
  let viewpoint = 0
  let lastRefine = null
  for (const s of saved) {
    const key = PHASE_TO_STEP[s.phase]
    if (!key) continue
    if (key === 'closeup_move') viewpoint++
    if (key === 'analyzing' && typeof s.meta?.refine_score === 'number') lastRefine = s.meta.refine_score
    const g = byKey[key] || (byKey[key] = { key, steps: [], tries: [] })
    g.steps.push(s)
    if (key === 'grasping') {
      g.tries.push({
        n: g.tries.length + 1,
        viewpoint: `Viewpoint ${Math.max(1, viewpoint)}`,
        refine: lastRefine != null ? lastRefine.toFixed(2) : '—',
        result: isBad(s) ? 'Blocked' : 'Gripped',
        tone: isBad(s) ? 'fail' : 'ok',
        secs: s.duration_seconds ?? null,
      })
    }
    seq.push(key)
  }

  // The last grasp is logged as a warning even when it went through, so the proof that it
  // worked is that the robot carried on to the handover.
  const g0 = byKey.grasping
  if (g0 && g0.tries.length && (byKey.transit || byKey.release)) {
    g0.tries[g0.tries.length - 1] = { ...g0.tries[g0.tries.length - 1], result: 'Gripped', tone: 'ok' }
  }

  // where a failed order gave up: the recorded phase, else the last step it reached
  let failKey = null
  if (failed) {
    failKey = PHASE_TO_STEP[order?.failure?.at_phase] || seq[seq.length - 1] || null
  }

  const rows = []
  PIPELINE.forEach((p) => {
    if (p.key === 'scene_scan') return
    const g = byKey[p.key]
    if (!g) {
      rows.push({ key: p.key, title: p.title, state: 'pending', summary: '', metrics: [], attempts: null, secs: null, dur: '', typ: '', slow: false, why: '', raw: [], badge: '', openDefault: false })
      return
    }

    const secs = g.steps.reduce((a, s) => a + (s.duration_seconds || 0), 0)
    const anyFailed = g.steps.some(s => s.status === 'failed')
    const anyWarn = g.steps.some(s => s.status === 'warning')
    let state = anyFailed ? 'fail' : anyWarn ? 'warn' : 'done'
    if (failKey === p.key) state = 'fail'
    // an order that was delivered after blocked tries is amber, not red
    if (state === 'fail' && !failed) state = 'warn'

    const metrics = []
    let summary = ''
    const last = g.steps[g.steps.length - 1]
    const metas = g.steps.map(s => s.meta || {})
    const reason = last.failure_detail || g.steps.find(s => s.failure_detail)?.failure_detail || ''

    switch (p.key) {
      case 'searching': {
        const places = (order?.waypoints_searched || []).map(friendlyWaypoint)
        if (state === 'fail') summary = places.length ? `No ${item} on the ${places.join(' or the ')}.` : `Couldn’t find ${item}.`
        else if (places.length === 1) summary = `Found on the ${places[0]}.`
        else if (places.length > 1) summary = `Checked the ${places.join(', then the ')}.`
        if (places.length) metrics.push({ k: 'Places', v: String(places.length) })
        if (state === 'fail') metrics.push({ k: 'Detections', v: '0' })
        break
      }
      case 'anchor_select': {
        const m = metas.find(x => x.anchor_score != null) || {}
        if (m.anchor_distance_cm != null) summary = `Closest match is ${Math.round(m.anchor_distance_cm)} cm away.`
        if (m.anchor_score != null) metrics.push({ k: 'Match', v: Number(m.anchor_score).toFixed(2) })
        if (m.anchor_distance_cm != null) metrics.push({ k: 'Distance', v: `${Math.round(m.anchor_distance_cm)} cm` })
        break
      }
      case 'closeup_move':
        summary = g.steps.length > 1 ? `${plural(g.steps.length, 'viewpoint', 'viewpoints')} used.` : 'Close-up view above the item.'
        if (order?.retries) metrics.push({ k: 'Retries', v: String(order.retries) })
        break
      case 'analyzing': {
        const r = scoreRange(metas.map(x => x.refine_score))
        const d = metas.filter(x => typeof x.depth_m === 'number').pop()
        const a = metas.filter(x => typeof x.refine_area_px === 'number').pop()
        if (state !== 'fail') summary = 'Grasp point found.'
        if (r) metrics.push({ k: 'Refine', v: r })
        if (d) metrics.push({ k: 'Depth', v: `${d.depth_m.toFixed(2)} m` })
        if (a) metrics.push({ k: 'Area', v: `${Math.round(a.refine_area_px / 1000)}k px` })
        break
      }
      case 'grasping': {
        const ok = g.tries.find(t => t.tone === 'ok')
        const bad = g.tries.filter(t => t.tone === 'fail').length
        if (ok) summary = g.tries.length === 1 ? 'Gripped on the first try.' : `Gripped on try ${ok.n} after ${plural(bad, 'blocked try', 'blocked tries')}.`
        else summary = `${plural(bad, 'try was', 'tries were')} blocked.`
        if (tries?.summary) summary = tries.summary
        if (order?.grasp_width_mm) metrics.push({ k: 'Grip', v: `${order.grasp_width_mm} mm` })
        metrics.push({ k: 'Tries', v: String(g.tries.length) })
        if (order?.collision_warnings) metrics.push({ k: 'Collisions', v: String(order.collision_warnings) })
        break
      }
      case 'transit': summary = state === 'fail' ? 'No clear path to the handover desk.' : 'Moved to the handover desk.'; break
      case 'release':
        summary = state === 'fail' && order?.failure?.reason === 'arm_fault'
          ? 'The gripper would not open: the arm’s controller had a fault.'
          : state === 'fail' ? 'The handover did not complete.'
          : handoverText({ person: order?.handover?.person_seen ?? null, releaseReason: order?.handover?.release_reason ?? null }, item, true)
        break
      case 'returning': summary = 'Returned to the home position.'; break
      default:
    }

    // why: what the step does, plus what went wrong in plain words when it did
    let why = WHY[p.key] || ''
    if (state === 'fail' && p.key === 'release' && order?.failure?.reason === 'arm_fault') why = `The arm’s controller reported a fault, so the gripper could not open. ${why}`
    const raw = []
    for (const s of g.steps) {
      const line = metaLine(s.phase, s.meta)
      if (line) raw.push(line)
      if (s.failure_detail) raw.push(`${s.phase} ${s.status || 'warning'}: ${s.failure_detail}`)
    }
    if (failKey === p.key && order?.failure?.detail) {
      const plain = translateFault(order.failure.detail)
      if (plain) why = `${plain} ${why}`
      raw.push(order.failure.detail)
    } else if (reason && state !== 'done') {
      why = `${reason}. ${why}`
    }

    const typ = typical[p.key]
    rows.push({
      key: p.key,
      title: p.title,
      state,
      summary,
      metrics,
      attempts: p.key === 'grasping' && !tries && g.tries.length > 1 ? g.tries : null,
      secs,
      dur: fmtDuration(secs),
      typ: typ == null ? '' : typ < 1 ? 'typical under 1s' : `typical ${fmtDuration(typ)}`,
      slow: typ != null && secs > Math.max(typ * 1.5, typ + 5),
      why,
      raw,
      badge: state === 'warn' && p.key === 'grasping' ? 'Needed retries' : '',
      openDefault: state === 'fail' || (p.key === 'grasping' && !!tries),
      judge: judgeNote(judge, p.key, 'grocery'),
      tries: p.key === 'grasping' ? tries : null,
    })
  })
  return rows
}

/** One plain sentence on what happened to a saved order, or '' for a clean delivery. */
export function orderHeadline(order) {
  if (!order) return ''
  if (order.robot === 'bar') return barOrderHeadline(order)
  if (isDelivered(order)) return ''
  if (order.failure?.reason === 'arm_fault') {
    const held = order.critic?.verdict === 'holding' ? ` The ${JUDGE_NAME} had confirmed I was holding it, so the ${order.item || 'item'} itself was fine.` : ''
    return `The arm’s controller reported a fault during the handover, so the gripper would not open and the order could not be finished.${held} The arm needs a person to restart it.`
  }
  if (order.failure?.reason === 'item_not_held') return `The ${JUDGE_NAME} did not see the item in the gripper, so I did not hand it over.`
  const plain = translateFault(order.failure?.detail)
  if (order.status === 'warning') return plain ? `Delivered, with trouble on the way: ${plain}` : 'Delivered, with warnings on the way.'
  return plain || 'The order could not be delivered.'
}
