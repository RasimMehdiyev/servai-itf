/** Plain-words rendering of bar log events (the bar's counterpart of lib/logTranslate.translateEvent). */
import { fmtLitres } from '../../lib/format'

const bottleNo = (detail) => {
  const m = String(detail || '').match(/bottle (\d+)/) || String(detail || '').match(/rack_hole_\d+_(\d+)/)
  return m ? parseInt(m[1], 10) + 1 : null
}

export function translateBarFault(detail) {
  const d = String(detail || '')
  if (/no bottles available|refill/i.test(d)) return 'The rack is out of bottles. It needs a refill before the next drink.'
  if (/not safe to shake/i.test(d)) return `I think it is unsafe to shake${bottleNo(d) ? ` bottle ${bottleNo(d)}` : ' the bottle'}, so I skipped the shake.`
  if (/could not pick bottle/i.test(d)) return 'The robot could not pick up the bottle from the rack.'
  if (/glass/i.test(d) && /no |not found|0 glass/i.test(d)) return 'The robot could not find a glass to pour into.'
  if (/KeyboardInterrupt|operator/i.test(d)) return 'An operator stopped the drink.'
  return null
}

export function translateBarEvent(msg) {
  const { type, component, status } = msg
  const detail = msg.detail || ''
  if (type === 'cycle_start') return { plain: `Drink ${msg.cycleNum} started.`, tone: 'ok' }
  if (type === 'cycle_end') {
    if (msg.outcome === 'SUCCESS') return { plain: 'Drink finished.', tone: 'ok' }
    return { plain: translateBarFault(detail) || 'The drink could not be finished.', tone: 'fail' }
  }
  if (type === 'rack_scan') return { plain: `Rack scan: ${msg.bottles} bottles, ${msg.capped} capped.`, tone: 'ok' }
  if (type === 'gripper') {
    if (!msg.success) return { plain: 'The gripper did not respond as expected.', tone: 'fail' }
    return { plain: /closed/i.test(msg.message || '') ? 'Gripper closed.' : 'Gripper opened.', tone: 'ok' }
  }
  if (type !== 'phase') return null
  switch (component) {
    case 'DECAP':
      if (status === 'BEGIN') return { plain: 'Checking the bottle for a cap.', tone: 'ok' }
      if (status === 'SKIP') return { plain: 'No capped bottles, nothing to open.', tone: 'ok' }
      return null
    case 'DECAP_MOVE': return { plain: 'Moved over the bottle to look at it.', tone: 'ok' }
    case 'SHAKE': return status === 'FAIL' ? { plain: translateBarFault(detail), tone: 'warn' } : { plain: 'Shook the bottle.', tone: 'ok' }
    case 'TRACK': return status === 'SKIP' ? { plain: 'No customer interaction, carrying on.', tone: 'ok' } : { plain: 'Customer seen.', tone: 'ok' }
    case 'TRACK_MOVE': return { plain: 'Moved to look for a customer.', tone: 'ok' }
    case 'POUR_BEGIN': return { plain: 'Starting to pour.', tone: 'ok' }
    case 'GLASS_DETECT': {
      const n = detail.match(/(\d+) glass/)
      return status === 'FAIL' ? { plain: translateBarFault(detail) || 'No glass found.', tone: 'fail' } : { plain: `${n ? n[1] : 'A'} glass${n && n[1] !== '1' ? 'es' : ''} ready.`, tone: 'ok' }
    }
    case 'BOTTLE_GRAB': { const b = bottleNo(detail); return { plain: `Picked up ${b ? `bottle ${b}` : 'the bottle'} from the rack.`, tone: 'ok' } }
    case 'POUR_MOVE': return { plain: 'Carried the bottle to the pouring position.', tone: 'ok' }
    case 'GLASS': {
      const f = detail.match(/glass (\d+)\/(\d+) filled/)
      return { plain: f ? `Glass ${f[1]} of ${f[2]} filled.` : 'Glass filled.', tone: 'ok' }
    }
    case 'BOTTLE_RETURN': return { plain: 'Put the bottle back in the rack.', tone: 'ok' }
    case 'BOTTLE': return status === 'FAIL' ? { plain: translateBarFault(detail) || 'Could not pick up a bottle.', tone: 'fail' } : null
    case 'POUR_DONE': {
      const p = detail.match(/poured ([\d.]+)/)
      return { plain: p ? `Pour finished: ${fmtLitres(parseFloat(p[1]))} poured.` : 'Pour finished.', tone: 'ok' }
    }
    default: return null
  }
}
