/**
 * View-model builders for the bartender's Live page — the bar's counterpart of lib/liveView.js
 * (deriveSteps / deriveNowServing return the same shapes, so the cards render either robot).
 */

import { BAR_PIPELINE, BAR_WHY, barStageTitle } from './pipeline'
import { translateBarFault } from './translate'
import { fmtDuration, fmtLitres } from '../../lib/format'
import { spentSeconds } from '../../lib/stageTime'
import { typicalStepSeconds, itemStats } from '../../lib/orderStats'
import { criticView, judgeNote } from '../../lib/critic'

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const bottleNo = (ev) => (ev && typeof ev.bottle === 'number' ? ev.bottle + 1 : null)

export function stepText(key, ev) {
  const b = bottleNo(ev)
  const bottle = b ? `bottle ${b}` : 'the bottle'
  const out = { summary: '', metrics: [] }
  if (!ev) return out
  switch (key) {
    case 'decap':
      out.summary = (ev.decapSkipped ? 'No capped bottles, nothing to open.' : 'Checked the bottle.')
        + (ev.shakeUnsafe ? ' The shake was skipped.' : '')
      if (b) out.metrics.push({ k: 'Bottle', v: String(b) })
      break
    case 'track':
      out.summary = ev.customer ? 'A customer was seen.' : 'No customer interaction, carried on.'
      break
    case 'glass':
      out.summary = ev.glasses != null ? `${plural(ev.glasses, 'glass is', 'glasses are')} ready.` : 'Looking for the glass…'
      if (ev.glasses != null) out.metrics.push({ k: 'Glasses', v: String(ev.glasses) })
      break
    case 'grab':
      out.summary = `Picked up ${bottle} from the rack.`
      if (b) out.metrics.push({ k: 'Bottle', v: String(b) })
      break
    case 'pour':
      out.summary = ev.glassesFilled ? `Glass ${ev.glassesFilled} of ${ev.glasses ?? ev.glassesFilled} filled.` : 'Pouring…'
      if (ev.poured != null) out.summary += ` ${fmtLitres(ev.poured)} poured.`
      if (ev.glassesFilled) out.metrics.push({ k: 'Filled', v: `${ev.glassesFilled}/${ev.glasses ?? ev.glassesFilled}` })
      break
    case 'return':
      out.summary = ev.refillNeeded
        ? 'Put the bottle back, but no other bottle was left to pick up. The rack needs a refill.'
        : 'Put the bottle back in the rack.'
      if (ev.poured != null) out.metrics.push({ k: 'Poured', v: fmtLitres(ev.poured) })
      if (ev.rackBottles != null) out.metrics.push({ k: 'Rack', v: `${ev.rackBottles} bottles` })
      break
    default:
  }
  return out
}

/** state: done | warn | active | activeWarn | fail | pending */
export function deriveBarSteps(liveData, history, nowMs = Date.now()) {
  if (!liveData?._stageInfo) return []
  const typical = typicalStepSeconds(history)
  const info = liveData._stageInfo
  const ev = liveData._ev
  const complete = !!liveData._cycleComplete
  const failedCycle = complete && liveData._cycleOutcome === 'FAIL'
  const cardState = liveData._cardState
  const cursorKey = liveData._stageCursor?.key
  const curIdx = BAR_PIPELINE.findIndex(p => p.key === cursorKey)
  // amber for something that happened in this drink, not for the carried-over "refill the rack" note
  const judge = criticView(liveData)
  const orangeNow = (liveData._cycleFailures || []).some(f => f.level === 'orange' && f.component !== 'CARRY' && f.component !== 'SHAKE')

  return BAR_PIPELINE.map((p, idx) => {
    const si = info[p.key]
    let state
    if (!complete) {
      if (curIdx < 0) state = 'pending'
      else if (p.key === cursorKey) state = cardState === 'red' ? 'fail' : (cardState === 'orange' && orangeNow) ? 'activeWarn' : 'active'
      else state = si ? 'done' : idx < curIdx ? 'done' : 'pending'
    } else if (failedCycle) {
      state = p.key === cursorKey ? 'fail' : si ? 'done' : 'pending'
    } else {
      state = p.key === 'return' && ev?.refillNeeded ? 'warn' : 'done'
    }

    // the vision model said it was unsafe to shake: not a failure, but worth seeing
    const shakeSkipped = p.key === 'decap' && !!ev?.shakeUnsafe && state === 'done'
    if (shakeSkipped) state = 'warn'
    const text = stepText(p.key, ev)
    const secs = state === 'pending' ? null : spentSeconds(liveData, p.key, nowMs)
    const typ = typical[p.key]
    const running = state === 'active' || state === 'activeWarn'
    return {
      key: p.key,
      title: p.title,
      state,
      summary: state === 'pending' ? '' : text.summary,
      metrics: state === 'pending' ? [] : text.metrics,
      attempts: null,
      secs,
      dur: secs == null ? '' : running ? `${fmtDuration(secs)} so far` : fmtDuration(secs),
      typ: typ == null ? '' : typ < 1 ? 'typical under 1s' : `typical ${fmtDuration(typ)}`,
      slow: typ != null && secs != null && secs > Math.max(typ * 1.5, typ + 5),
      why: BAR_WHY[p.key] || '',
      raw: (si?.raw || []).map(r => r.text),
      timestamp: '',
      badge: shakeSkipped ? 'Shake skipped' : state === 'warn' && p.key === 'return' ? 'Refill needed' : '',
      openDefault: state === 'fail' || state === 'warn' || state === 'activeWarn',
      alert: null,
      judge: state === 'pending' ? null : judgeNote(judge, p.key, 'bar'),
    }
  })
}

const HEAD = {
  decap: (ev) => `Checking ${bottleNo(ev) ? `bottle ${bottleNo(ev)}` : 'the bottle'} before pouring.`,
  track: () => 'Looking for a customer.',
  glass: () => 'Finding the glass to pour into.',
  grab: (ev) => `Picking up ${bottleNo(ev) ? `bottle ${bottleNo(ev)}` : 'the bottle'} from the rack.`,
  pour: () => 'Pouring the drink.',
  return: () => 'Putting the bottle back in the rack.',
}

const NEXT = {
  decap: 'Next: look for a customer, then pour.',
  track: 'Next: find the glass.',
  glass: 'Next: pick up the bottle.',
  grab: 'Next: pour into the glass.',
  pour: 'Next: put the bottle back in the rack.',
  return: 'Almost done: the drink is finished once the bottle is back.',
}

export function barContextSentence(history, retries = 0) {
  const s = itemStats(history, 'bottle')
  if (s.n < 3) return ''
  const refills = s.warnings
  const time = s.medianSeconds ? `, typically ${fmtDuration(s.medianSeconds)} each` : ''
  const parts = [`Drinks so far: ${s.n}${time}.`]
  if (refills) parts.push(`${plural(refills, 'drink was', 'drinks were')} poured, then found the rack out of bottles.`)
  if (s.failed) parts.push(`${plural(s.failed, 'drink', 'drinks')} failed.`)
  return parts.join(' ')
}

export function deriveBarNowServing(liveData, history, nowMs = Date.now()) {
  const startedAt = liveData?._cycleStartedAt
  const elapsedSec = startedAt ? Math.max(0, (nowMs - startedAt) / 1000) : 0
  const cardState = liveData?._cardState || 'green'
  const ev = liveData?._ev
  const complete = !!liveData?._cycleComplete
  const isActive = !!liveData?._itemName && !complete
  const waiting = !!liveData?._itemName && complete && cardState === 'red'
  const refill = !!ev?.refillNeeded
  const failedCycle = complete && liveData?._cycleOutcome === 'FAIL'
  const stageKey = liveData?._stageCursor?.key

  const shown = deriveBarSteps(liveData, history, nowMs)
  const seg = shown.map(s => s.state)
  let phaseLabel = ''
  if (shown.length && (isActive || waiting)) {
    if (waiting && refill && !failedCycle) {
      phaseLabel = `Finished all ${shown.length} steps · the rack needs a refill`
    } else {
      let idx = shown.findIndex(s => s.key === stageKey)
      if (idx < 0) idx = Math.max(0, shown.filter(s => s.state === 'done').length - 1)
      phaseLabel = waiting ? `Stopped at step ${idx + 1} of ${shown.length} · ${shown[idx].title}` : `Step ${idx + 1} of ${shown.length} · ${shown[idx].title}`
    }
  }

  let headline = liveData?.explanationText || ''
  if (isActive) headline = (HEAD[stageKey] || (() => headline))(ev)
  if (waiting) {
    headline = failedCycle
      ? (translateBarFault(liveData?.explanationText) || liveData?.explanationText || 'The drink could not be finished.')
      : `The drink is poured${ev?.poured != null ? ` (${fmtLitres(ev.poured)}, glass ${ev.glassesFilled || 1} of ${ev.glasses ?? 1} filled)` : ''}. Only the rack needs attention: it is out of bottles.`
  }

  // evidence rows
  const evidence = []
  const b = bottleNo(ev)
  if (ev) {
    if (waiting && refill) {
      if (ev.rackBottles != null) evidence.push({ label: 'Rack', value: String(ev.rackBottles), note: `bottles at the last scan${ev.rackCapped ? `, ${ev.rackCapped} capped` : ''}` })
      if (ev.poured != null) evidence.push({ label: 'Poured', value: fmtLitres(ev.poured), note: 'in the glass: the drink itself is fine' })
      if (ev.glassesFilled) evidence.push({ label: 'Glass', value: `${ev.glassesFilled} of ${ev.glasses ?? ev.glassesFilled}`, note: 'filled' })
    } else {
      if (b) evidence.push({ label: 'Bottle', value: String(b), note: ev.rackBottles != null ? `of ${ev.rackBottles} in the rack` : 'in the rack' })
      if (ev.glasses != null) evidence.push({ label: 'Glass', value: `${ev.glassesFilled || 0} of ${ev.glasses}`, note: ev.glassesFilled ? 'filled' : 'ready to fill' })
      if (ev.shakeUnsafe) evidence.push({ label: 'Shake', value: 'Skipped', note: 'the AI Judge’s call, see below' })
    }
  }

  // next / if it goes wrong
  let next = NEXT[stageKey] || ''
  let ifWrong = ''
  if (waiting && refill && !failedCycle) {
    next = 'Refill the rack with bottles, then the next drink can be made.'
    ifWrong = 'The next drink will hit the same problem until the rack is refilled.'
  } else if (waiting) {
    next = 'Please come over and look at the bar.'
    ifWrong = 'The drink stays open until you choose.'
  } else if (isActive) {
    ifWrong = 'If there is no bottle left to pick up afterwards, I finish this pour and ask you to refill the rack.'
  }

  const context = barContextSentence(history)

  // ETA
  let eta = { label: 'ETA', value: '--', note: '' }
  if (waiting) {
    eta = { label: 'Waiting for you', value: liveData?._cycleEndedAt ? fmtDuration((nowMs - liveData._cycleEndedAt) / 1000) : '--', note: '' }
  } else if (isActive) {
    const s = itemStats(history, 'bottle')
    if (s.n >= 3 && s.medianSeconds != null) {
      const left = Math.max(0, Math.round(s.medianSeconds - elapsedSec))
      eta = { label: 'ETA', value: left === 0 ? 'any moment' : `~${fmtDuration(left)}`, note: `typical drink: ${fmtDuration(s.medianSeconds)}` }
    }
  }

  const issues = [...(liveData?._cycleFailures || [])].reverse().map(f => ({
    ts: f.ts,
    level: f.level,
    text: f.message,
    where: barStageTitle(f.component) || (f.component === 'GRIPPER' ? 'Picking up the bottle' : f.component === 'CYCLE' ? 'Drink' : ''),
  }))

  // the rack was empty after the last drink, or this drink has just found it empty
  const carried = isActive && (!!liveData?._refillNeeded || refill)
  const actions = ((waiting && refill && !failedCycle) || carried)
    ? { primary: { id: 'refilled', label: 'I’ve refilled the rack' }, secondaries: [{ id: 'delayed', label: 'Tell customer it’s delayed' }] }
    : null

  return {
    isActive, waiting, cardState, seg, phaseLabel, headline, evidence, next, ifWrong, context, eta, issues,
    kind: waiting && refill ? 'refill' : 'other',
    pillText: (waiting && refill && !failedCycle) || carried ? 'Refill needed' : null,
    actions,
  }
}

