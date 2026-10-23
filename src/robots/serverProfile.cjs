/**
 * Per-robot behaviour for the relay (ws-test-server.js).
 *
 * The relay is started once per robot (ROBOT=grocery|bar). Everything robot
 * specific lives here, so the relay's order bookkeeping stays one code path:
 *
 *   phases             the steps an order is folded into (saved as order.steps[].phase)
 *   normalize(evt)     rewrites the parsed log line into the events the relay already
 *                      understands (cycle_start, object_selected, phase, gripper, …).
 *                      Pure: a replay normalises the whole log up front.
 *   observe(evt)       called as each (normalised) event is processed; keeps the per-drink facts
 *                      that orderExtras() reports when the order is written
 *   isValidItem(name)  whether an "item" is real (anything else is treated as stray input)
 *   failureClass(evt)  'red' | 'orange' | null — how serious a FAIL line is (undefined = default)
 *   failureMessage(evt)
 *   classifyFailure / classifyFailureFriendly
 *   meta(evt)          numbers to keep on the step
 *   orderExtras()      extra fields for the saved order
 *
 * grocery returns {} — the relay's built-in behaviour is the grocery robot's.
 */

function barProfile() {
  const PHASES = [
    { phase: 'decap',  friendly_name: 'Checking the bottle',      components: ['DECAP', 'SHAKE', 'DECAP_MOVE'] },
    { phase: 'track',  friendly_name: 'Looking for a customer',   components: ['TRACK', 'TRACK_MOVE'] },
    { phase: 'glass',  friendly_name: 'Finding the glass',        components: ['POUR_BEGIN', 'GLASS_DETECT'] },
    { phase: 'grab',   friendly_name: 'Picking up the bottle',    components: ['BOTTLE_GRAB'] },
    { phase: 'pour',   friendly_name: 'Pouring',                  components: ['POUR_MOVE', 'GLASS'] },
    { phase: 'return', friendly_name: 'Putting the bottle back',  components: ['BOTTLE_RETURN', 'BOTTLE', 'POUR_DONE'] },
  ]

  // per drink cycle, filled in by observe()
  let cycle = null
  // a drink cycle is open between its "drink cycle N" BEGIN and its end (see normalize)
  let open = false
  // across cycles: the last rack scan
  let rack = null
  const fresh = () => ({ bottle: null, glasses: 0, glassesFilled: 0, poured: null, customer: false, decapSkipped: false, shakeUnsafe: false, rackBottles: rack ? rack.bottles : null })

  const holeOf = (text) => {
    const m = String(text || '').match(/rack_hole_(\d+)_(\d+)/)
    return m ? { side: parseInt(m[1], 10), bottle: parseInt(m[2], 10) } : null
  }
  // the bottle a line is about: "…rack_hole_0_1…" or "(side 0, bottle 1)"
  const bottleOf = (text) => {
    const h = holeOf(text)
    if (h) return h.bottle
    const m = String(text || '').match(/bottle (\d+)\)/)
    return m ? parseInt(m[1], 10) : null
  }

  // BARISTA:ARM_MOVE lines name where the arm went; only the moves that tell us which
  // step the robot is in become events. The rest ("avoid_coll2_pos" …) are transit.
  const armMoveComponent = (detail) => {
    const d = String(detail || '')
    const seq = d.match(/seq \[(.*)\]/)
    const names = seq ? seq[1].split(',').map(s => s.trim().replace(/'/g, '')) : []
    if (/bottle_detect_rack_hole/.test(d)) return 'DECAP_MOVE'
    if (/face_tracking_detect_pos/.test(d)) return 'TRACK_MOVE'
    if (names.length && /^pour_approach_pos$/.test(names[0])) return 'BOTTLE_RETURN'
    if (names.length && /grab_rack_hole/.test(names[names.length - 1])) return 'BOTTLE_GRAB'
    if (names.length && /^pour_approach_pos$/.test(names[names.length - 1])) return 'POUR_MOVE'
    return null
  }

  function classifyFailure(detail) {
    const d = String(detail || '').toLowerCase()
    if (d.includes('no bottles available') || d.includes('refill')) return 'bottles_empty'
    if (d.includes('not safe to shake')) return 'unsafe_to_shake'
    if (d.includes('glass') && (d.includes('no ') || d.includes('not found') || d.includes('0 glass'))) return 'no_glass'
    if (d.includes('could not pick bottle')) return 'bottle_pick_failed'
    if (d.includes('pour')) return 'pour_failed'
    if (d.includes('gripper') && d.includes('fail')) return 'gripper_failed'
    if (d.includes('e_stop') || d.includes('emergency')) return 'e_stopped'
    if (d.includes('timeout')) return 'timeout'
    if (d.includes('keyboardinterrupt') || d.includes('operator abort')) return 'operator_abort'
    return 'unknown'
  }

  const FRIENDLY = {
    bottles_empty: 'Out of bottles — refill needed',
    unsafe_to_shake: 'Not safe to shake',
    no_glass: 'No glass found',
    bottle_pick_failed: 'Could not pick up the bottle',
    pour_failed: 'Pour failed',
    gripper_failed: 'Grip failure',
    e_stopped: 'Emergency stop',
    timeout: 'Timeout',
    operator_abort: 'Operator aborted',
    unknown: 'Unknown failure',
  }

  return {
    robotId: 'BAR',
    phases: PHASES,
    isValidItem: () => true,

    classifyFailure,
    classifyFailureFriendly: (detail) => FRIENDLY[classifyFailure(detail)] || FRIENDLY.unknown,

    // The pour has already happened when the robot reports it cannot pick the *next* bottle, so
    // that is a red failure the cycle recovers from (the order is saved as "warning": refill needed).
    failureClass(evt) {
      if (evt.component === 'BOTTLE') return 'red'
      if (evt.component === 'GLASS_DETECT' || evt.component === 'GLASS' || evt.component === 'POUR_DONE') return 'red'
      return 'orange'   // SHAKE and everything else
    },
    failureMessage(evt) {
      return evt.detail || `${evt.component} failed`
    },

    meta(evt) {
      const out = {}
      const bottle = bottleOf(evt.detail)
      if (bottle != null) out.bottle = bottle
      const filled = String(evt.detail || '').match(/glass (\d+)\/(\d+) filled/)
      if (evt.component === 'GLASS' && filled) { out.glasses_filled = parseInt(filled[1], 10); out.glasses = parseInt(filled[2], 10) }
      const ready = String(evt.detail || '').match(/(\d+) glass\(es\) ready/)
      if (evt.component === 'GLASS_DETECT' && ready) out.glasses = parseInt(ready[1], 10)
      const poured = String(evt.detail || '').match(/poured ([\d.]+)/)
      if (poured) out.poured = parseFloat(poured[1])
      return out
    },

    observe(evt) {
      if (!evt) return
      const detail = evt.detail || ''
      if (evt.type === 'cycle_start') { cycle = fresh(); return }
      if (evt.type === 'rack_scan') {
        if (evt.bottles != null) rack = { bottles: evt.bottles, capped: evt.capped }
        return
      }
      if (!cycle) return
      const b = bottleOf(detail)
      if (b != null && cycle.bottle == null) cycle.bottle = b
      if (evt.type !== 'phase') return
      switch (evt.component) {
        case 'DECAP': if (evt.status === 'SKIP') cycle.decapSkipped = true; break
        case 'SHAKE': if (evt.status === 'FAIL') cycle.shakeUnsafe = true; break
        case 'TRACK': if (evt.status !== 'SKIP') cycle.customer = true; break
        case 'GLASS_DETECT': { const n = String(detail).match(/(\d+) glass/); if (n) cycle.glasses = parseInt(n[1], 10); break }
        case 'GLASS': {
          const f = String(detail).match(/glass (\d+)\/(\d+) filled/)
          if (f) { cycle.glassesFilled = parseInt(f[1], 10); cycle.glasses = parseInt(f[2], 10) }
          break
        }
        case 'POUR_DONE': { const p = String(detail).match(/poured ([\d.]+)/); if (p) cycle.poured = parseFloat(p[1]); break }
        default:
      }
    },

    orderExtras() {
      const c = cycle || fresh()
      return {
        bottle: c.bottle,
        glasses_filled: c.glassesFilled,
        glasses: c.glasses,
        poured: c.poured,
        customer_seen: c.customer,
        decap_skipped: c.decapSkipped,
        shake_unsafe: c.shakeUnsafe,
        rack_bottles: c.rackBottles,
      }
    },

    /** One parsed log line in, the events the relay should process out. */
    normalize(evt) {
      if (!evt) return []
      const detail = evt.detail || evt.text || ''

      if (evt.type === 'cycle_start') {
        // Only the bar's own cycles ("drink cycle N") start a drink: the grocery robot's "cycle N" lines
        // (a log fed to this relay by mistake) must not turn into drinks.
        if (!/drink cycle/i.test(evt.detail || '')) return []
        open = true
        // the relay keys an order on its item; a drink cycle always pours from "a bottle"
        return [evt, { ts: evt.ts, type: 'object_selected', objectName: 'bottle' }]
      }
      if (evt.type === 'cycle_end') {
        if (!open && !/drink cycle/i.test(detail)) return []
        open = false
        return [evt]
      }

      if (evt.type === 'calibration') {
        // BARISTA:STARTUP … "demo loop ready" is the bar's "bring-up complete"
        if (/loop ready/i.test(detail) && evt.status === 'SUCCESS') return [{ ...evt, action: 'BRINGUP' }]
        return [evt]
      }

      if (evt.type === 'phase') {
        const component = evt.component
        if (component === 'DECAP') return [evt]
        if (component === 'POUR') {
          if (evt.status === 'BEGIN') return [{ ...evt, component: 'POUR_BEGIN', origin: 'POUR' }]
          return [{ ...evt, component: 'POUR_DONE', origin: 'POUR' }]
        }
        return [evt]
      }

      if (evt.type === 'system_event' && evt.component === 'BARISTA') {
        const base = { ts: evt.ts, type: 'phase', status: evt.status, detail, origin: `BARISTA:${evt.action}` }
        switch (evt.action) {
          case 'ARM_MOVE': {
            const comp = armMoveComponent(detail)
            return comp ? [{ ...base, component: comp }] : []
          }
          case 'GRIPPER':
            return [{ ts: evt.ts, type: 'gripper', success: evt.status !== 'FAIL', message: /closed/i.test(detail) ? 'Gripper closed' : 'Gripper opened', raw: detail }]
          case 'SHAKE': {
            // "VLM: not safe to shake (side 0, bottle 1)": the vision-language model (the AI Judge) looked
            // at the bottle and decided. The step itself carries on (the shake is skipped); the verdict is
            // reported as the judge's own event so the dashboard can show who said it.
            const out = [{ ...base, component: 'SHAKE' }]
            if (/\bVLM\b/i.test(detail)) {
              const unsafe = /not safe|unsafe/i.test(detail)
              out.push({
                ts: evt.ts, type: 'critic', kind: 'verdict', topic: 'shake', status: evt.status,
                verdict: unsafe ? 'unsafe_to_shake' : 'safe_to_shake', holding: null,
                bottle: bottleOf(detail), text: detail.replace(/^\s*VLM:\s*/i, ''), detail, origin: 'BARISTA:SHAKE',
              })
            }
            return out
          }
          case 'TRACK': return [{ ...base, component: 'TRACK' }]
          case 'GLASS_DETECT': return [{ ...base, component: 'GLASS_DETECT' }]
          case 'GLASS': return [{ ...base, component: 'GLASS' }]
          case 'BOTTLE': return [{ ...base, component: 'BOTTLE' }]
          case 'RACK_SCAN': {
            const r = String(detail).match(/(\d+) bottles?, (\d+) capped/)
            return [{ ts: evt.ts, type: 'rack_scan', bottles: r ? parseInt(r[1], 10) : null, capped: r ? parseInt(r[2], 10) : null, detail }]
          }
          default:
            return []   // STATE and the rest: nothing for the dashboard
        }
      }
      return [evt]
    },
  }
}

module.exports = function serverProfile(id) {
  if (id === 'bar') return barProfile()
  return {}
}
