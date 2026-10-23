/**
 * The grocery robot's newest log (critic system + arm fault) through the relay and the Live/History logic.
 *
 *   node scripts/test-grocery-critic.mjs [path/to/log]      (default: scripts/fixtures/grocery_critic_2026-10-21.log)
 *
 * The log holds two orders: a coffee mug that is handed over, and a water bottle whose handover ends in
 * "gripper open failed" because the arm's controller faulted. Besides the usual lines it carries the
 * AI Judge's own output ([critic-service], in local time) and unstructured arm-controller lines.
 *
 *   relay     judge lines become `critic` events on the same clock; arm lines become red faults
 *   orders    order.critic summarises what the judge said; the failed order is an arm_fault at "handing_over"
 *   Live      the judge's box, the judge's note on "Bringing it over", the arm fault outlives the idle state
 *   History   the same judge box and notes on the saved order
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const WebSocket = require('ws')

const logFile = path.resolve(process.argv[2] || path.join(ROOT, 'scripts/fixtures/grocery_critic_2026-10-21.log'))
const PORT = 8796
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'servai-critic-'))
const dataDir = path.join(tmp, 'data')
fs.mkdirSync(dataDir, { recursive: true })

const entry = path.join(tmp, 'entry.js')
const rel = (p) => JSON.stringify(path.join(ROOT, p).replace(/\\/g, '/'))
fs.writeFileSync(entry, `
export { liveReducer, liveInitialState } from ${rel('src/services/liveState.js')}
export { deriveNowServing, deriveSteps, deriveLog } from ${rel('src/lib/liveView.js')}
export * as orderSteps from ${rel('src/lib/orderSteps.js')}
export * as critic from ${rel('src/lib/critic.js')}
export { PROFILES } from ${rel('src/robots/profiles.js')}
`)
const bundle = path.join(tmp, 'app.mjs')
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent' })
const App = await import(pathToFileURL(bundle).href)

let failures = 0
let checks = 0
function check(cond, msg, extra) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`) }
}
const clean = (v) => !/undefined|NaN|\[object|null/.test(String(v))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let out = ''
const relay = spawn(process.execPath, [path.join(ROOT, 'ws-test-server.js')], {
  cwd: ROOT,
  env: { ...process.env, ROBOT: 'grocery', STATIC_REPLAY: '1', REPLAY_ONCE: '1', REPLAY_START_DELAY: '1500', REPLAY_LOG: logFile, DATA_DIR: dataDir, WS_PORT: String(PORT), REPLAY_SPEED: '400' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
relay.stdout.on('data', d => { out += d })
relay.stderr.on('data', d => { out += d })

const events = []
try {
  for (let i = 0; i < 150 && !/WebSocket: ws/.test(out); i++) await sleep(100)
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
  ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.type !== 'heartbeat' && m.type !== 'source_mode') events.push(m) })
  for (let i = 0; i < 600 && !/Loop \d+ complete/.test(out); i++) await sleep(100)
  await sleep(600)
  ws.close()
} finally {
  relay.kill()
  await sleep(200)
}

console.log(`Collected ${events.length} events from ${path.basename(logFile)}`)

// ── relay: the judge's lines and the arm's lines ──────────────────────────────
const critic = events.filter(e => e.type === 'critic')
const kinds = {}
for (const e of critic) kinds[e.kind] = (kinds[e.kind] || 0) + 1
console.log('  critic events:', JSON.stringify(kinds))
check(kinds.phase >= 10 && kinds.roi === 2 && kinds.check >= 14 && kinds.verdict >= 4, 'the judge produced phases, areas, checks and verdicts', kinds)
const t0 = Date.parse('2026-10-21T15:10:00Z'), t1 = Date.parse('2026-10-21T15:15:00Z')
check(critic.every(e => Date.parse(e.ts) >= t0 && Date.parse(e.ts) <= t1), 'judge timestamps are on the orchestrator clock (the log is local time, UTC+2)', critic.filter(e => !(Date.parse(e.ts) >= t0 && Date.parse(e.ts) <= t1)).slice(0, 2).map(e => e.ts))
const checksEv = critic.filter(e => e.kind === 'check')
check(checksEv.every(e => /^Is the robot holding an? (coffee mug|water bottle)\?$/.test(e.question)), 'every check carries the question that was asked', [...new Set(checksEv.map(e => e.question))])
check(checksEv.every(e => e.answer === 'YES' || e.answer === 'NO') && checksEv.some(e => e.answer === 'NO'), 'answers are YES/NO and the single NO is kept', checksEv.filter(e => e.answer === 'NO').length)
check(critic.filter(e => e.kind === 'roi').every(e => e.roi.x0 === 0.1 && e.roi.x1 === 0.75 && e.roi.y0 === 0 && e.roi.y1 === 1), 'the area the judge looks at (crop x 0.1 to 0.75) is reported')
const verdicts = critic.filter(e => e.kind === 'verdict' && e.status === 'SUCCESS')
check(verdicts.length === 2 && verdicts.every(e => e.holding === true && e.quiet === 2.5), 'ITEM_CHECK becomes a verdict: holding, no alert in 2.5 s', verdicts.map(e => [e.item, e.holding, e.quiet]))
check(events.some(e => e.type === 'phase' && e.component === 'HANDOVER_RELEASE' && e.status === 'BEGIN'), 'the HANDOVER_RELEASE BEGIN line is no longer mistaken for a prompt')

const faults = events.filter(e => e.type === 'system_fault' && e.source === 'arm')
check(faults.length >= 4 && faults.length < 12, 'arm lines become a handful of faults (repeats collapsed)', faults.length)
check(faults.every(e => e.severity === 'red' && clean(e.plain) && e.plain.length > 20), 'arm faults are red and explained in plain words', faults.map(e => e.plain))
const insideCycle2 = events.findIndex(e => e.type === 'system_fault') < events.findIndex((e, i) => e.type === 'cycle_end' && i > 0 && e.outcome === 'FAIL')
check(insideCycle2, 'the first fault comes before the order is reported failed')
const grip = events.filter(e => e.type === 'gripper' && !e.success)
check(grip.length >= 1 && grip.every(e => /failed to open/.test(e.message)), 'a gripper FAIL line no longer reads "Gripper opened"', grip.map(e => e.message))

const handoverEv = events.filter(e => e.type === 'handover')
check(handoverEv.length >= 4 && handoverEv.some(e => e.person === false) && handoverEv.some(e => e.person === true), 'the handover desk: "no person seen" and "presenting toward person" are reported', handoverEv.map(e => e.person))

// ── pictures taken at the failure ("What I saw") ───────────────────────────────
const pics = events.filter(e => e.type === 'failure_image')
check(pics.length === 4 && pics.every(p => /^fail_\d+_d415$/.test(p.imageId) && p.camera === 'd415'), 'the relay tells the dashboard about each failure picture', pics.map(p => p.imageId))
check(pics.some(p => p.component === 'HANDOVER_RELEASE'), 'a picture knows which step it belongs to', pics.map(p => p.component))
const imgDir = path.join(dataDir, 'images')
check(pics.every(p => fs.existsSync(path.join(imgDir, p.imageId + '.jpg')) && fs.statSync(path.join(imgDir, p.imageId + '.jpg')).size > 5000), 'a replay has a real picture for each (sample pictures stand in for the log\'s placeholders)')
const firstPic = events.findIndex(e => e.type === 'failure_image')
check(firstPic > events.findIndex(e => e.type === 'cycle_start' && e.cycleNum === 2) || firstPic > 0, 'pictures arrive while the order is running')

// ── orders ────────────────────────────────────────────────────────────────────
const orders = JSON.parse(fs.readFileSync(path.join(dataDir, 'orders.json'), 'utf8'))
check(orders.length === 2, 'two orders saved', orders.length)
const [o1, o2] = orders
check(o1?.item === 'coffee mug' && o1.status === 'success' && !o1.failure, 'order 1: coffee mug handed over', [o1?.item, o1?.status])
check(o1?.critic?.verdict === 'holding' && o1.critic.item === 'coffee mug' && o1.critic.checks >= 7 && o1.critic.yes === o1.critic.checks, 'order 1: the judge confirmed the grip on every look', o1?.critic)
check(o1?.critic?.roi?.x0 === 0.1 && /coffee mug/.test(o1.critic.question), 'order 1: the judge\'s area and question are kept')
check(o2?.item === 'water bottle' && o2.status === 'failed', 'order 2: water bottle not delivered', [o2?.item, o2?.status])
check(o2?.failure?.reason === 'arm_fault' && o2.failure.at_phase === 'handing_over', 'order 2: failed because of the arm, in the handover', o2?.failure)
check(o2?.critic?.verdict === 'holding' && o2.critic.no === 1 && o2.critic.checks >= 7, 'order 2: the judge had confirmed the grip (one look said no)', [o2?.critic?.verdict, o2?.critic?.yes, o2?.critic?.no])
check(o1?.handover?.person_seen === false && o1.handover.release_reason === 'tug', 'order 1: nobody at the desk, the item was pulled out of the gripper (tug)', o1?.handover)
check(o2?.handover?.person_seen === true && o2.handover.release_reason === null, 'order 2: a person was found, the gripper never opened', o2?.handover)
const stepStates = Object.fromEntries((o2?.steps || []).map(s => [s.phase, s.status]))
check(stepStates.bringing_over === 'ok' && stepStates.handing_over === 'failed', 'order 2: "Bringing it over" ok, "Handing over" failed', stepStates)

// ── Live ──────────────────────────────────────────────────────────────────────
const idleView = App.critic.criticView(App.liveInitialState)
check(idleView?.mode === 'thinking' && idleView.line === 'Thinking' && idleView.title === 'Thinking', 'Live: the AI Judge is always there; with nothing to say it says "Thinking"', idleView?.line)
check(App.critic.orderCriticView({ id: 1 }) === null, 'History: an order the judge did not rule on has no judge box')
let state = App.liveInitialState
let cycle = 0
const seen = { checking: false, holding: false, watching: false }
const watchLines = new Set()
let atEnd1 = null
for (const m of events) {
  state = App.liveReducer(state, { type: 'ws_message', message: m })
  if (m.type === 'cycle_start') cycle++
  const v = App.critic.criticView(state)
  if (v?.mode === 'watching' || v?.mode === 'holding') { seen.watching = true; watchLines.add(v.line) }
  if (v?.mode === 'checking' && !seen.checking) {
    seen.checking = true
    check(/Is the robot holding the coffee mug|Is the robot holding a coffee mug/.test(v.line) && v.looks >= 1, 'Live: while checking, the judge shows its question and the looks so far', v.line)
    const rows = App.deriveSteps(state, [], Date.now())
    const transit = rows.find(r => r.key === 'transit')
    check(transit?.judge?.tone === 'info' && /Looking at the gripper/.test(transit.judge.text), 'Live: "Bringing it over" carries the judge\'s note while it checks', transit?.judge)
    const ns = App.deriveNowServing(state, [], Date.now())
    check(/AI Judge is checking/.test(ns.headline), 'Live: the headline says the AI Judge is checking', ns.headline)
  }
  if (v?.mode === 'holding' && !seen.holding && cycle === 1) {
    seen.holding = true
    check(/I confirm the coffee mug is grabbed/.test(v.line) && v.tone === 'ok' && v.title === 'Confirmed', 'Live: verdict "I confirm the coffee mug is grabbed"', v.line)
    check(v.facts.some(f => f.k === 'Looks') && v.roi?.x0 === 0.1, 'Live: the box shows the looks and the area watched')
  }
  if (m.type === 'cycle_end' && cycle === 1) atEnd1 = state
}
check(seen.checking && seen.holding, 'Live: both the checking and the holding states were seen')
check([...watchLines].some(l => /Watching the search for the coffee mug/.test(l)) && [...watchLines].some(l => /Now: watching the handover/.test(l)), 'Live: between verdicts the judge says what it watches, never just "Thinking" during an order', [...watchLines])

const rel1 = App.deriveSteps(atEnd1, [], Date.now()).find(r => r.key === 'release')
check(/No one was at the desk/.test(rel1.summary) && /took the coffee mug out of the gripper/.test(rel1.summary), 'Live: "Handing over" says how the mug left the gripper', rel1.summary)
check((atEnd1._failureImages || []).length === 0, 'Live: the delivered mug has no failure pictures ("All clear")', (atEnd1._failureImages || []).length)
check((state._failureImages || []).length === 4 && state._failureImages[0].imageId === pics[0].imageId, 'Live: the failed order shows its four pictures', (state._failureImages || []).length)
const nextCycle = App.liveReducer(state, { type: 'ws_message', message: { type: 'cycle_start', cycleNum: 3, ts: '2026-10-21T15:20:00.000Z' } })
check((nextCycle._failureImages || []).length === 0, 'Live: the next order starts "All clear" again')
const ns1 = App.deriveNowServing(atEnd1, [], Date.now())
check(ns1.cardState === 'green' && ns1.judge?.mode === 'holding', 'Live: after the delivered mug the card is green and the judge is "holding"', [ns1.cardState, ns1.judge?.mode])

check(state._armFault && state._cardState === 'red', 'Live: after the last event the arm fault is still on (red)', [state._cardState, !!state._armFault])
const idle = App.liveReducer(state, { type: 'ws_message', message: { type: 'system_state', state: 'idle', ts: '2026-10-21T15:14:30.000Z' } })
check(idle._cardState === 'red' && /arm/i.test(idle.explanationText), 'Live: "idle" does not hide an arm fault', [idle._cardState, idle.explanationText])
const recovered = App.liveReducer(idle, { type: 'ws_message', message: { type: 'fault_recovery', source: 'bridge', detail: 'motion possible', ts: '2026-10-21T15:15:00.000Z' } })
check(!recovered._armFault && recovered._cardState === 'green', 'Live: the arm fault ends when the robot reports motion is possible again', [recovered._cardState, !!recovered._armFault])

const ns = App.deriveNowServing(state, [], Date.now())
check(ns.kind === 'arm' && ns.waiting, 'Live: the failed order is explained by the arm', [ns.kind, ns.waiting])
check(/arm’s controller reported a fault/.test(ns.headline) && /gripper would not open/.test(ns.headline), 'Live: headline names the arm fault and the gripper', ns.headline)
check(/drives powered/.test(ns.next) && /may still be in the gripper/.test(ns.next), 'Live: what to do next: check drives and alarms, the bottle may still be held', ns.next)
check(ns.evidence.some(e => e.label === 'Arm controller') && ns.evidence.some(e => e.label === 'Gripper' && e.value === 'Did not open'), 'Live: evidence rows: arm controller fault, gripper did not open', ns.evidence)
check(ns.judge?.mode === 'holding' && /I confirm the water bottle is grabbed/.test(ns.judge.line), 'Live: the judge\'s verdict stays visible: it confirmed the water bottle was grabbed', ns.judge?.line)
for (const k of ['headline', 'next', 'ifWrong', 'phaseLabel']) check(clean(ns[k]), `Live: ${k} has no junk`, ns[k])
const rows = App.deriveSteps(state, [], Date.now())
const transit = rows.find(r => r.key === 'transit'), release = rows.find(r => r.key === 'release')
check(transit.state === 'done' && transit.judge?.tone === 'ok' && /water bottle/.test(transit.judge.text), 'Live: "Bringing it over" done with the judge\'s ok note', [transit.state, transit.judge])
check(release.state === 'fail' && /would not open/.test(release.summary), 'Live: "Handing over" failed, the gripper would not open', [release.state, release.summary])
check(!ns.issues.some(i => /Something went wrong/.test(i.text)) && ns.issues.some(i => /arm/i.test(i.text)), 'Live: issues name the arm, not "Something went wrong"', ns.issues.map(i => i.text))

const log = App.deriveLog(state, 40)
check(log.some(l => l.source === 'judge' && /^AI Judge: /.test(l.plain)), 'Live: the plain-words log has AI Judge rows, marked as the judge\'s', log.filter(l => l.source === 'judge').length)
check(log.some(l => /arm/i.test(l.plain) && l.tone === 'fail'), 'Live: the log explains the arm fault')
check(log.every(l => clean(l.plain) && clean(l.raw)), 'Live: log rows read cleanly')

// ── History ───────────────────────────────────────────────────────────────────
const asSaved = (o) => ({ ...o, phases: o.steps })
const h2 = App.orderSteps.deriveOrderSteps(asSaved(o2), orders)
const hTransit = h2.find(r => r.key === 'transit'), hRelease = h2.find(r => r.key === 'release')
check(hTransit.state === 'done' && hTransit.judge?.tone === 'ok', 'History: order 2 "Bringing it over" carries the judge\'s note', hTransit.judge)
check(hRelease.state === 'fail' && /would not open/.test(hRelease.summary), 'History: order 2 "Handing over" failed with the reason', [hRelease.state, hRelease.summary])
const head = App.orderSteps.orderHeadline(asSaved(o2))
check(/arm’s controller reported a fault/.test(head) && /AI Judge had confirmed/.test(head), 'History: headline: arm fault, and the judge had confirmed the grip', head)
const jv = App.critic.orderCriticView(asSaved(o2))
check(jv?.mode === 'holding' && jv.facts.length >= 2 && clean(jv.line), 'History: the saved order has a judge box', jv?.line)
check(App.orderSteps.deriveOrderSteps(asSaved(o1), orders).find(r => r.key === 'transit').judge?.tone === 'ok', 'History: order 1 has the judge\'s note too')
const hRel1 = App.orderSteps.deriveOrderSteps(asSaved(o1), orders).find(r => r.key === 'release')
check(/took the coffee mug out of the gripper/.test(hRel1.summary), 'History: order 1 "Handing over" says how the mug left the gripper', hRel1.summary)
check(App.PROFILES.grocery.reasons.arm_fault === 'Arm fault' && App.PROFILES.grocery.explanations.arm_fault.length > 40, 'History: "Arm fault" has a label and an explanation')

console.log(`\n${checks - failures}/${checks} checks passed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failures ? 1 : 0)
