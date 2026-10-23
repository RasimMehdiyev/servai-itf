/** Step rows for a saved bar order (the bar's counterpart of lib/orderSteps.js). */

import { BAR_PIPELINE, BAR_WHY } from './pipeline'
import { stepText } from './view'
import { translateBarFault } from './translate'
import { typicalStepSeconds } from '../../lib/orderStats'
import { fmtDuration, fmtLitres } from '../../lib/format'
import { orderCriticView, judgeNote } from '../../lib/critic'

const metaLine = (phase, meta) => {
  const parts = Object.entries(meta || {}).map(([k, v]) => `${k}=${v}`)
  return parts.length ? `${phase} ${parts.join(' ')}` : null
}

export function deriveBarOrderSteps(order, history = []) {
  const saved = order?.phases || order?.steps || []
  const typical = typicalStepSeconds(history)
  // the saved order carries what the Live evidence tracked
  const ev = {
    bottle: typeof order?.bottle === 'number' ? order.bottle : null,
    rackBottles: order?.rack_bottles ?? null,
    glasses: order?.glasses ?? null,
    glassesFilled: order?.glasses_filled ?? 0,
    poured: order?.poured ?? null,
    customer: !!order?.customer_seen,
    decapSkipped: !!order?.decap_skipped,
    shakeUnsafe: !!order?.shake_unsafe,
    refillNeeded: order?.failure?.reason === 'bottles_empty',
  }
  const failed = order?.status === 'failed'
  const failAt = order?.failure?.at_phase
  const judge = orderCriticView(order)

  return BAR_PIPELINE.map((p) => {
    const s = saved.find(x => x.phase === p.key)
    if (!s) {
      return { key: p.key, title: p.title, state: 'pending', summary: '', metrics: [], attempts: null, secs: null, dur: '', typ: '', slow: false, why: '', raw: [], badge: '', openDefault: false }
    }
    let state = s.status === 'failed' ? 'fail' : s.status === 'warning' ? 'warn' : 'done'
    if (failAt === p.key) state = failed ? 'fail' : order?.status === 'warning' ? 'warn' : state
    // the vision model said it was unsafe to shake: not a failure, but worth seeing
    const shakeSkipped = p.key === 'decap' && ev.shakeUnsafe && state === 'done'
    if (shakeSkipped) state = 'warn'
    const text = stepText(p.key, ev)
    const secs = s.duration_seconds || 0
    const typ = typical[p.key]
    let why = BAR_WHY[p.key] || ''
    const raw = []
    const line = metaLine(s.phase, s.meta)
    if (line) raw.push(line)
    if (s.failure_detail) raw.push(`${s.phase} ${s.status || 'warning'}: ${s.failure_detail}`)
    if (failAt === p.key && order?.failure?.detail) {
      const plain = translateBarFault(order.failure.detail)
      if (plain) why = `${plain} ${why}`
      raw.push(order.failure.detail)
    }
    return {
      key: p.key,
      title: p.title,
      state,
      summary: text.summary,
      metrics: text.metrics,
      attempts: null,
      secs,
      dur: fmtDuration(secs),
      typ: typ == null ? '' : typ < 1 ? 'typical under 1s' : `typical ${fmtDuration(typ)}`,
      slow: typ != null && secs > Math.max(typ * 1.5, typ + 5),
      why,
      raw,
      badge: shakeSkipped ? 'Shake skipped' : state === 'warn' && p.key === 'return' && ev.refillNeeded ? 'Refill needed' : '',
      openDefault: state === 'fail' || state === 'warn',
      judge: judgeNote(judge, p.key, 'bar'),
    }
  })
}

export function barOrderHeadline(order) {
  if (!order || order.status === 'success' || order.status === 'ok') return ''
  const plain = translateBarFault(order.failure?.detail)
  if (order.status === 'warning') {
    const amount = order.poured != null ? `${fmtLitres(order.poured)} poured, glass ${order.glasses_filled || 1} of ${order.glasses || 1} filled. ` : ''
    if (order.failure?.reason === 'bottles_empty') return `${amount}The drink itself is fine; the rack is out of bottles and needs a refill.`
    return plain ? `${amount}But: ${plain}` : 'Poured, with warnings on the way.'
  }
  return plain || 'The drink could not be finished.'
}
