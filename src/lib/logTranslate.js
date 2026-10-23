/**
 * Turns robot log events into plain words for the Live page.
 *
 * `translateEvent` powers the "In plain words" column of Technical details and
 * `translateFault` replaces raw controller text (contact_stop, safety_clamp, IK
 * branch flips…) that used to be shown to operators as-is.
 * Pure functions — no React, no DOM.
 */

const WAYPOINT_LABELS = {
  'top-shelve': 'top shelf',
  'bottom-shelve': 'bottom shelf',
  'left-shelve': 'left shelf',
  'right-shelve': 'right shelf',
  'top-corner': 'top corner',
  'bottom-corner': 'bottom corner',
  'clothes-rack': 'clothes rack',
  'corner': 'corner',
}

export function friendlyWaypoint(wp) {
  return WAYPOINT_LABELS[wp] || wp
}

/** "HH:MM:SS" in the viewer's local time from an ISO/UTC timestamp. */
export function clock(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (!Number.isNaN(d.getTime())) {
    const p = (n) => String(n).padStart(2, '0')
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
  const m = String(ts).match(/(\d{2}:\d{2}:\d{2})/)
  return m ? m[1] : ''
}

/** Plain-words version of raw hardware / controller error text. Returns null if nothing matches. */
export function translateFault(detail) {
  const d = String(detail || '')
  if (/contact_stop/i.test(d)) {
    return 'The arm touched something and stopped itself. A technician has to clear the stop on the teach pendant.'
  }
  if (/safety_clamp|safety_scale/i.test(d)) {
    return 'The safety controller slowed the arm to a halt because the motion would not make progress.'
  }
  const knot = d.match(/first knot is ([\d.]+)° from live arm \(max permitted ([\d.]+)/i)
  if (knot) {
    return `The arm had not settled where the plan expected (${knot[1]}° off, limit ${knot[2]}°), so I refused to move.`
  }
  const flip = d.match(/all (\d+) ranked candidates failed/i)
  if (/branch flip/i.test(d) || flip) {
    return `All ${flip ? flip[1] : 'the'} candidate grasps were rejected: reaching them would need an unsafe swing of the arm.`
  }
  if (/goalset_size=(\d+)/i.test(d)) {
    const n = d.match(/goalset_size=(\d+)/i)[1]
    return `All ${n} candidate grasps were rejected: the arm would hit something on the way.`
  }
  if (/pre-filter rejected entire goalset/i.test(d)) {
    return 'Every candidate grasp was rejected before planning: the item is outside the arm’s comfortable reach.'
  }
  if (/no valid depth/i.test(d)) {
    return 'The depth camera could not measure the distance to the item, so I could not plan the grasp.'
  }
  if (/search exhausted/i.test(d)) {
    const n = d.match(/\((\d+) waypoints? tried\)/)
    const item = d.match(/'([^']+)' not found/)
    return `Looked in ${n ? n[1] : 'every'} place${n && n[1] === '1' ? '' : 's'} and saw no ${item ? item[1] : 'matching item'}. Stopping the search.`
  }
  if (/KeyboardInterrupt|operator/i.test(d)) return 'An operator stopped the order.'
  if (/handover motion failed/i.test(d)) return 'The arm could not find a clear path to the handover desk.'
  if (/gripper_open|gripper open failed|open failed/i.test(d)) return 'The gripper would not open to release the item.'
  if (/gripper closed/i.test(d)) return 'The gripper closed on nothing, so no item is being held.'
  return null
}

const num = (m, i = 1) => (m ? parseFloat(m[i]) : null)

/** One-line raw log text (what an engineer would grep for). */
export function rawText(msg) {
  // `origin` is the robot's own name for the line when the relay renamed it (the bar's BARISTA:ARM_MOVE …)
  const comp = msg.origin || (msg.component ? msg.component + (msg.action ? ':' + msg.action : '') : msg.type)
  const status = msg.status ? ' ' + msg.status : msg.outcome ? ' ' + msg.outcome : ''
  const detail = msg.detail || msg.text || msg.raw || msg.objectName || ''
  const line = `${comp}${status} ${detail}`.trim()
  return line.length > 240 ? line.slice(0, 237) + '…' : line
}

/**
 * Plain-words rendering of one event, or null when the event is not worth a row.
 * ctx: { itemName }  — the item of the order in progress, for friendlier text.
 */
export function translateEvent(msg, ctx = {}) {
  const item = ctx.itemName || 'the item'
  const { type, component, status } = msg
  const detail = msg.detail || ''

  if (type === 'cycle_start') return { plain: `Order #${msg.cycleNum} started.`, tone: 'ok' }
  if (type === 'object_selected') return { plain: `New order: ${msg.objectName}.`, tone: 'ok' }
  if (type === 'cycle_end') {
    if (msg.outcome === 'SUCCESS') return { plain: 'Order delivered.', tone: 'ok' }
    return { plain: translateFault(detail) || 'The order could not be delivered.', tone: 'fail' }
  }
  if (type === 'collision_warning') {
    return { plain: 'The planner rejected a path because it would collide with something.', tone: 'warn' }
  }
  if (type === 'gripper') {
    if (!msg.success) {
      const m = msg.message || ''
      return { plain: /failed to open/i.test(m) ? 'The gripper would not open.' : /failed to close/i.test(m) ? 'The gripper would not close.' : 'The gripper did not respond as expected.', tone: 'fail' }
    }
    return { plain: /open/i.test(msg.message || '') ? 'Gripper opened.' : 'Gripper closed.', tone: 'ok' }
  }
  if (type === 'system_fault') {
    if (msg.plain) return { plain: msg.plain, tone: msg.severity === 'red' ? 'fail' : 'warn' }
    return { plain: translateFault(msg.detail) || 'The arm controller reported a fault. Recovering on its own.', tone: 'warn' }
  }
  if (type === 'handover') {
    return msg.person === false
      ? { plain: 'No one was at the handover desk, so I am waiting at the fallback spot for someone to take the item.', tone: 'warn' }
      : { plain: 'Holding the item out to the customer.', tone: 'ok' }
  }
  if (type === 'fault_recovery') return { plain: 'The fault cleared. Continuing.', tone: 'ok' }
  if (type !== 'phase') return null

  switch (component) {
    case 'SEARCH_DETECT': {
      const wp = friendlyWaypoint(msg.waypoint) || 'here'
      if (status === 'BEGIN') return { plain: `Looking for ${item} on the ${wp}.`, tone: 'ok' }
      if (status === 'SUCCESS') {
        const m = detail.match(/(\d+) survived/)
        return { plain: m ? `Spotted ${m[1]} possible match${m[1] === '1' ? '' : 'es'}.` : 'Spotted possible matches.', tone: 'ok' }
      }
      if (status === 'FAIL') return { plain: `Nothing on the ${wp}.`, tone: 'warn' }
      return null
    }
    case 'ANCHOR_SELECT': {
      if (status !== 'SUCCESS') return null
      const m = detail.match(/#1\(d=([\d.]+)cm,score=([\d.]+)\)/)
      return { plain: m ? `Chose the closest match, ${Math.round(num(m))} cm away (score ${m[2]}).` : 'Chose a target.', tone: 'ok' }
    }
    case 'CLOSEUP_MOVE': {
      if (status === 'SUCCESS') return { plain: 'Reached the close-up viewpoint.', tone: 'ok' }
      if (status === 'BEGIN' && /retry/i.test(detail)) return { plain: 'Moving to a new viewpoint.', tone: 'warn' }
      return null
    }
    case 'CLOSEUP_REFINE': {
      if (status !== 'SUCCESS') return null
      const s = detail.match(/score=([\d.]+)/)
      const a = detail.match(/area=(\d+)px/)
      return { plain: `Found the grasp point (score ${s ? s[1] : '?'}${a ? ', about ' + Math.round(a[1] / 100) / 10 + 'k pixels visible' : ''}).`, tone: 'ok' }
    }
    case 'CLOSEUP_LIFT': {
      if (status === 'SUCCESS') {
        const m = detail.match(/depth_med=([\d.]+)/)
        return { plain: m ? `Measured the distance: ${parseFloat(m[1]).toFixed(2)} m.` : 'Measured the distance.', tone: 'ok' }
      }
      if (status === 'FAIL') return { plain: translateFault(detail) || 'Could not measure the distance. The surface may be too shiny.', tone: 'fail' }
      return null
    }
    case 'SYNTHESISE': {
      if (status !== 'SUCCESS') return null
      const w = detail.match(/width=([\d.]+) mm/)
      const g = detail.match(/goalset=(\d+)\/(\d+)/)
      return { plain: `Planned the grip${w ? ': ' + w[1] + ' mm wide' : ''}${g ? ', ' + g[1] + ' of ' + g[2] + ' candidates accepted' : ''}.`, tone: 'ok' }
    }
    case 'EXECUTE_GRASP': {
      if (status === 'SUCCESS') return { plain: `Picked up ${item}.`, tone: 'ok' }
      if (status === 'FAIL') return { plain: translateFault(detail) || `Could not pick up ${item}.`, tone: 'warn' }
      return null
    }
    case 'CLOSEUP_RETRY': {
      if (status === 'BEGIN') {
        const m = detail.match(/retry (\d+)\/(\d+)/)
        return { plain: m ? `Moving to a new viewpoint (retry ${m[1]} of ${m[2]}).` : 'Moving to a new viewpoint.', tone: 'warn' }
      }
      return null
    }
    case 'ITEM_CHECK': {
      // the judge's own verdict arrives as a separate event; only the start and a failure are worth a row here
      if (status === 'BEGIN') return { plain: `Carrying ${item} to the spot where the AI Judge can check my grip.`, tone: 'ok' }
      if (status === 'FAIL') return { plain: 'The AI Judge could not confirm that I am holding the item.', tone: 'warn' }
      return null
    }
    case 'HANDOVER_TRANSIT': return status === 'BEGIN' ? { plain: `Carrying ${item} towards the handover desk.`, tone: 'ok' } : null
    case 'HANDOVER_MOVE': {
      if (status === 'SUCCESS') return { plain: 'At the handover position.', tone: 'ok' }
      if (status === 'FAIL') return { plain: translateFault(detail) || 'The arm could not find a clear path to the handover desk.', tone: 'fail' }
      return null
    }
    case 'HANDOVER_RELEASE': {
      if (status === 'SUCCESS') return { plain: /release_reason=tug/.test(detail) ? 'The customer took the item: the gripper opened when it was pulled.' : 'Handed over to the customer.', tone: 'ok' }
      if (status === 'FAIL') return { plain: translateFault(detail) || 'The handover did not complete.', tone: 'fail' }
      return null
    }
    case 'HANDOVER_RETURN':
    case 'RETURN_HOME':
      return status === 'SUCCESS' ? { plain: 'Back at the home position.', tone: 'ok' } : null
    default:
      return null
  }
}
