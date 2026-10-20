/**
 * Pure helpers that turn the saved order history (data/orders.json) into the
 * "how this usually goes" numbers the Live page shows next to the current order.
 * Nothing here touches React, so it can be unit-tested against the real file.
 */

// Failure reason keys → short phrases, matching the History failure radar.
export const REASON_PHRASE = {
  reachability_failed: 'path blocked',
  search_exhausted: 'not found',
  no_valid_depth: 'depth failed',
  handover_failed: 'blocked at handover',
  operator_abort: 'aborted by an operator',
  unknown: 'stopped for another reason',
}

// Short outcome labels, same wording as the History failure radar.
export const REASON_LABEL = {
  reachability_failed: 'Path blocked',
  search_exhausted: 'Not found',
  no_valid_depth: 'Depth failed',
  handover_failed: 'Handover blocked',
  operator_abort: 'Aborted',
  unknown: 'Stopped',
}

// order.steps[].phase (saved) → live pipeline step key (messageMapper PIPELINE)
export const PHASE_TO_STEP = {
  searching: 'searching',
  anchor_select: 'anchor_select',
  closeup_move: 'closeup_move',
  analyzing: 'analyzing',
  grasping: 'grasping',
  bringing_over: 'transit',
  handing_over: 'release',
  returning: 'returning',
}

export function isDelivered(o) {
  return o.status === 'success' || o.status === 'ok'
}

export function median(values) {
  const v = values.filter(x => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

function sameItem(o, item) {
  return (o.item || '').toLowerCase() === (item || '').toLowerCase()
}

/** Counts and typical numbers for one item across all saved orders. */
export function itemStats(orders, item) {
  const list = (orders || []).filter(o => sameItem(o, item))
  const delivered = list.filter(isDelivered)
  const warnings = list.filter(o => o.status === 'warning')
  const failed = list.filter(o => o.status === 'failed')
  const byReason = {}
  for (const o of failed) {
    const r = o.failure?.reason || 'unknown'
    byReason[r] = (byReason[r] || 0) + 1
  }
  const finished = list.filter(o => o.status !== 'failed')
  return {
    item,
    n: list.length,
    delivered: delivered.length,
    warnings: warnings.length,
    failed: failed.length,
    byReason,
    // Typical time is taken from orders that actually reached the customer.
    medianSeconds: median(finished.map(o => o.total_seconds)),
    medianSecondsClean: median(delivered.map(o => o.total_seconds)),
    medianGraspMm: median(delivered.map(o => o.grasp_width_mm)),
  }
}

/** How orders of this item ended once they needed `retries` or more retries. */
export function retryStats(orders, item, retries) {
  const list = (orders || []).filter(o => sameItem(o, item) && (o.retries || 0) >= retries)
  return {
    n: list.length,
    delivered: list.filter(isDelivered).length,
    warnings: list.filter(o => o.status === 'warning').length,
    failed: list.filter(o => o.status === 'failed').length,
    medianSeconds: median(list.map(o => o.total_seconds)),
  }
}

/** Median duration of each live pipeline step, over orders that were delivered. */
export function typicalStepSeconds(orders) {
  const per = {}
  for (const o of orders || []) {
    if (!isDelivered(o)) continue
    const seen = {}
    for (const s of o.steps || []) {
      const key = PHASE_TO_STEP[s.phase]
      if (!key) continue
      // A step that repeats in one order (grasp retries) counts once, summed.
      seen[key] = (seen[key] || 0) + (s.duration_seconds || 0)
    }
    for (const [k, v] of Object.entries(seen)) (per[k] = per[k] || []).push(v)
  }
  const out = {}
  for (const [k, v] of Object.entries(per)) out[k] = v.length >= 5 ? median(v) : null
  return out
}

/** Sentence listing why an item's failed orders failed, e.g. "42 not found and 42 blocked at handover". */
export function failureBreakdownText(byReason) {
  const parts = Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `${n} ${REASON_PHRASE[r] || r}`)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/**
 * The "how this usually goes" sentence for the Now Serving card.
 * Returns '' when there is not enough history to say anything honest.
 */
export function contextSentence(orders, item, retriesSoFar = 0) {
  if (!item) return ''
  const s = itemStats(orders, item)
  if (s.n < 5) return ''
  const name = cap(item)
  if (retriesSoFar >= 1) {
    const r = retryStats(orders, item, retriesSoFar)
    if (r.n >= 5) {
      const time = r.medianSeconds ? ` Typically ${Math.round(r.medianSeconds)}s.` : ''
      const through = r.delivered + r.warnings
      const how = r.warnings === 0 ? '' : r.delivered === 0 ? ', all with warnings' : `, ${r.warnings} with warnings`
      const tail = through === 0 ? `None were delivered: all ${r.failed} failed.` : `${through} were delivered${how} and ${r.failed} failed.`
      return `${name} orders that needed ${retriesSoFar === 1 ? 'a retry' : retriesSoFar + ' retries'}: ${r.n} so far. ${tail}${time}`
    }
  }
  if (s.delivered + s.warnings === 0) {
    return `${name} orders so far: ${s.n}. None were delivered: ${failureBreakdownText(s.byReason)}.`
  }
  const time = s.medianSeconds ? `, typically in ${Math.round(s.medianSeconds)}s` : ''
  return `${name} orders so far: ${s.delivered} of ${s.n} delivered cleanly${time}.`
}

/** Seconds left for this order, from the item's typical time. null when history is too thin. */
export function etaSeconds(orders, item, elapsedSec) {
  const s = itemStats(orders, item)
  if (s.n < 5 || s.medianSeconds == null) return null
  return Math.max(0, Math.round(s.medianSeconds - elapsedSec))
}

/** Local calendar day (YYYY-MM-DD) of an ISO timestamp. */
export function localDay(iso) {
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Totals for one local day. */
export function dayStats(orders, dayStr) {
  const list = (orders || []).filter(o => o.started_at && localDay(o.started_at) === dayStr)
  const delivered = list.filter(isDelivered).length
  const warning = list.filter(o => o.status === 'warning').length
  const failed = list.filter(o => o.status === 'failed').length
  const secs = list.map(o => o.total_seconds || 0).filter(x => x > 0)
  return {
    date: dayStr,
    total: list.length,
    delivered,
    warning,
    failed,
    avgSeconds: secs.length ? Math.round(secs.reduce((a, b) => a + b, 0) / secs.length) : 0,
  }
}
