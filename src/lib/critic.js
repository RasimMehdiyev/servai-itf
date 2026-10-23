/**
 * The AI Judge.
 *
 * A second pair of eyes that is not part of the robot: a fixed camera on the side and a
 * vision-language model that look at the scene like a third person and say what they see
 * ("is the robot really holding the coffee mug?", "is it safe to shake this bottle?").
 * It never moves the robot; the robot's orchestrator acts on what it says.
 *
 * The relay turns the judge's log lines into `critic` events (kinds: phase, roi, check, verdict,
 * alert) and keeps a summary on every saved order (`order.critic`). This module is the one place
 * that folds those events into dashboard state and into the sentences the screens show, for both
 * robots, so the judge reads the same way everywhere. Pure functions, no React.
 */

import { rawText } from './logTranslate'

export const JUDGE_NAME = 'AI Judge'
export const JUDGE_BLURB = 'An independent camera and AI model that watches from the side, like a third person. It only judges; it never moves the robot.'

// What the judge is looking at, by the phase the orchestrator announced to it
const WATCHING = {
  idle: 'Waiting for an order',
  searching_object: 'Watching the search',
  inspecting_object: 'Watching the close-up',
  grasping_object: 'Watching the pick-up',
  'critic-item-checking-phase': 'Checking the grip',
  transporting_object: 'Watching the item travel',
  presenting_object: 'Watching the handover',
  holding_for_handover: 'Watching the handover',
  releasing_object: 'Watching the release',
  returning_home: 'Watching the arm go home',
}

export function watchingText(phase) {
  return WATCHING[phase] || (phase ? String(phase).replace(/[-_]/g, ' ') : '')
}

// ── state ───────────────────────────────────────────────────────────────────

export function newCritic(prev) {
  return {
    phase: prev?.phase || 'idle',
    item: null, topic: null, bottle: null,
    roi: prev?.roi || null,
    question: null,
    looks: 0, yes: 0, no: 0, latencyMs: 0,
    lastAnswer: null, lastAt: null,
    verdict: null, text: '', quiet: null,
    alerts: [],
  }
}

const MAX_LOG_ROWS = 40

function pushLog(data, msg, plain, tone) {
  const log = data._log || []
  const last = log[log.length - 1]
  if (last && last.plain === plain) return log
  return [...log, { ts: msg.ts, raw: rawText(msg), plain, tone, source: 'judge' }].slice(-MAX_LOG_ROWS)
}

const bottleNo = (b) => (typeof b === 'number' ? b + 1 : null)

/** Fold one `critic` event into the dashboard state (`_critic`, plus a row in the plain-words log). */
export function applyCritic(data, msg) {
  const c = { ...(data._critic || newCritic()) }
  let log = data._log || []
  const add = (plain, tone) => { log = pushLog({ _log: log }, msg, plain, tone) }

  switch (msg.kind) {
    case 'phase':
      c.phase = msg.phase || c.phase
      if (msg.target) c.item = msg.target
      if (msg.phase === 'critic-item-checking-phase') {
        c.looks = 0; c.yes = 0; c.no = 0; c.latencyMs = 0; c.verdict = null; c.alerts = []
        add(`${JUDGE_NAME}: I am checking whether the robot is holding ${msg.target ? `the ${msg.target}` : 'the item'}.`, 'ok')
      }
      break
    case 'roi':
      c.roi = msg.roi || c.roi
      break
    case 'check':
      c.looks += 1
      if (msg.answer === 'YES') c.yes += 1
      else c.no += 1
      c.latencyMs += Math.round((msg.latency || 0) * 1000)
      c.lastAnswer = msg.answer
      c.lastAt = msg.ts
      c.question = msg.question || c.question
      c.topic = c.topic || 'holding'
      break
    case 'verdict': {
      if (msg.status === 'BEGIN') break
      c.topic = msg.topic || c.topic
      if (msg.item) c.item = msg.item
      if (msg.quiet != null) c.quiet = msg.quiet
      if (msg.bottle != null) c.bottle = msg.bottle
      if (msg.verdict) c.verdict = msg.verdict
      else if (msg.holding === true) c.verdict = 'holding'
      else if (msg.holding === false) c.verdict = 'not_holding'
      c.text = msg.text || msg.detail || c.text
      const f = factsFromLive(c)
      const v = buildView(f)
      add(`${JUDGE_NAME}: ${v.line}`, v.tone === 'ok' ? 'ok' : v.tone === 'alert' ? 'fail' : 'warn')
      break
    }
    case 'alert':
      c.alerts = [...c.alerts, msg.text]
      add(`${JUDGE_NAME} raised an alert: ${msg.text}`, 'fail')
      break
    default:
  }
  return { ...data, _critic: c, _log: log }
}

/** The judge starts every order with a clean slate (it keeps its phase and the area it watches). */
export function resetCritic(data) {
  return { ...data, _critic: newCritic(data._critic) }
}

// ── facts ───────────────────────────────────────────────────────────────────
// One shape for both sources: the live state and the summary saved on an order.

export function factsFromLive(c, itemName) {
  if (!c) return null
  return {
    topic: c.topic, item: c.item || itemName || null, bottle: c.bottle, looks: c.looks, yes: c.yes, no: c.no,
    avgMs: c.looks ? Math.round(c.latencyMs / c.looks) : null,
    question: c.question, roi: c.roi, verdict: c.verdict, quiet: c.quiet, text: c.text,
    alerts: c.alerts || [], phase: c.phase, live: true,
  }
}

export function factsFromOrder(order) {
  const c = order?.critic
  if (!c) return null
  return {
    topic: c.topic, item: c.item, bottle: c.bottle, looks: c.checks || 0, yes: c.yes || 0, no: c.no || 0,
    avgMs: c.avg_latency_ms ?? null,
    question: c.question, roi: c.roi, verdict: c.verdict, quiet: c.quiet_seconds, text: c.text,
    alerts: c.alerts || [], phase: null, live: false,
  }
}

// ── sentences ───────────────────────────────────────────────────────────────

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/**
 * What the judge says, as a view model. First person: the judge speaks in its own box.
 *   tone: ok | warn | alert | info
 *   mode: thinking | watching | checking | holding | not_holding | unsafe_to_shake | safe_to_shake | alert
 */
// What the judge is doing in each phase it announces (grocery). With no verdict yet this is what it says.
const PHASE_LINE = {
  searching_object: (item) => `Watching the search for ${item}.`,
  inspecting_object: (item) => `Watching the close-up look at ${item}.`,
  grasping_object: (item) => `Watching the pick-up of ${item}. I check the grip next.`,
  'critic-item-checking-phase': (item) => `Checking whether ${item} is in the gripper…`,
  transporting_object: (item) => `Watching ${item} travel to the handover desk.`,
  presenting_object: (item) => `Watching the handover of ${item}.`,
  holding_for_handover: (item) => `Watching the handover of ${item}.`,
  releasing_object: (item) => `Watching the release of ${item}.`,
  returning_home: () => 'Watching the arm go home.',
}

export function buildView(f) {
  if (!f) return null
  const item = f.item ? `the ${f.item}` : 'the item'
  const facts = []
  if (f.looks) {
    facts.push({ k: 'Looks', v: String(f.looks) })
    facts.push({ k: 'Said yes', v: `${f.yes} of ${f.looks}` })
    if (f.avgMs != null) facts.push({ k: 'Each look', v: `${(f.avgMs / 1000).toFixed(2)} s` })
  }
  if (f.quiet != null) facts.push({ k: 'No alert for', v: `${f.quiet} s` })

  const base = {
    name: JUDGE_NAME, blurb: JUDGE_BLURB, roi: f.roi, question: f.question, facts,
    looks: f.looks, yes: f.yes, no: f.no,
    // what it is looking at right now: only the grocery judge announces phases (the bar's has none to announce)
    watching: f.live && f.phase && f.phase !== 'idle' ? watchingText(f.phase) : '',
    show: !!(f.looks || f.verdict || (f.alerts && f.alerts.length)),
  }

  if (f.alerts && f.alerts.length && f.verdict !== 'holding') {
    return { ...base, mode: 'alert', tone: 'alert', title: 'Alert', line: f.alerts[f.alerts.length - 1] }
  }
  if (f.verdict === 'unsafe_to_shake' || f.verdict === 'safe_to_shake') {
    const n = bottleNo(f.bottle)
    const which = n ? `bottle ${n}` : 'this bottle'
    return f.verdict === 'unsafe_to_shake'
      ? { ...base, mode: f.verdict, tone: 'warn', title: 'Shake skipped', line: `I think it is not safe to shake ${which}, so the shake was skipped. The drink goes on.` }
      : { ...base, mode: f.verdict, tone: 'ok', title: 'Safe to shake', line: `I think it is safe to shake ${which}.` }
  }
  if (f.verdict === 'holding') {
    const tally = f.looks ? ` ${f.yes} of ${plural(f.looks, 'look', 'looks')} agreed${f.no ? ` (a single “no” does not raise an alert)` : ''}.` : ''
    // after the check it keeps watching: say what it watches now
    const now = f.live && f.phase && f.phase !== 'idle' && f.phase !== 'critic-item-checking-phase' ? ` Now: ${watchingText(f.phase).toLowerCase()}.` : ''
    return { ...base, mode: 'holding', tone: 'ok', title: 'Confirmed', line: `I confirm ${item} is grabbed: I can see it in the gripper.${tally}${now}` }
  }
  if (f.verdict === 'not_holding') {
    return { ...base, mode: 'not_holding', tone: 'alert', title: 'Cannot confirm', line: `I cannot confirm ${item} is grabbed: I do not see it in the gripper.` }
  }
  if (f.looks) {
    return {
      ...base, mode: 'checking', tone: 'info', title: 'Checking',
      line: `Looking at the gripper from the side: “${f.question || `Is the robot holding ${item}?`}” So far ${f.yes} of ${plural(f.looks, 'look', 'looks')} said yes.`,
    }
  }
  // between verdicts it says what it is watching
  if (f.live && PHASE_LINE[f.phase]) {
    return { ...base, mode: 'watching', tone: 'info', title: 'Watching', line: PHASE_LINE[f.phase](item) }
  }
  // nothing to say (yet): the judge is always there, and says so
  return { ...base, mode: 'thinking', tone: 'info', title: 'Thinking', line: 'Thinking' }
}

/** The view for the Live card. The judge is always on screen: "Thinking" until it has something to say. */
export function criticView(data) {
  return buildView(factsFromLive(data?._critic || newCritic(), data?._itemName))
}

/** The view for a saved order (History). */
export function orderCriticView(order) {
  const v = buildView(factsFromOrder(order))
  return v && v.show ? v : null
}

/** A short note on a step row: what the judge said about this step, or null. */
export function judgeNote(view, stepKey, robot) {
  if (!view) return null
  if (robot === 'bar') {
    return stepKey === 'decap' && (view.mode === 'unsafe_to_shake' || view.mode === 'safe_to_shake')
      ? { tone: view.tone, text: view.line } : null
  }
  if (stepKey !== 'transit') return null
  if (view.mode === 'holding') return { tone: 'ok', text: view.line }
  if (view.mode === 'not_holding') return { tone: 'alert', text: view.line }
  if (view.mode === 'alert') return { tone: 'alert', text: view.line }
  if (view.mode === 'checking') return { tone: 'info', text: view.line }
  return null
}
