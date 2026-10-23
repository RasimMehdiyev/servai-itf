/**
 * The newest grocery log (8 orders, two of them needing a second or third look) through the relay and the
 * Live / History logic that explains tries and "what could change this".
 *
 *   node scripts/test-tries.mjs [path/to/log]      (default: scripts/fixtures/grocery_robot_2026-10-23.log)
 *
 *   relay     saves run_details on every order: item position and shelf, each attempt (where it looked from, what
 *             the planner said), the grip, the planner and motion settings; sends them to the dashboard as they grow
 *   words     attempts are described without robot terms; Now serving and the step say the same thing
 *   cards     the Heads-up before a pick-up and "What could change this?" after a failed try, from the orders so far
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
const logFile = path.resolve(process.argv[2] || path.join(ROOT, 'scripts/fixtures/grocery_robot_2026-10-23.log'))
const PORT = 8899
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'servai-tries-'))
const dataDir = path.join(tmp, 'data')
fs.mkdirSync(dataDir, { recursive: true })

const entry = path.join(tmp, 'entry.js')
const rel = (p) => JSON.stringify(path.join(ROOT, p).replace(/\\/g, '/'))
fs.writeFileSync(entry, `
export { liveReducer, liveInitialState } from ${rel('src/services/liveState.js')}
export { deriveNowServing, deriveSteps } from ${rel('src/lib/liveView.js')}
export * as orderSteps from ${rel('src/lib/orderSteps.js')}
export * as attempts from ${rel('src/lib/attempts.js')}
export * as cf from ${rel('src/lib/counterfactual.js')}
`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: path.join(tmp, 'app.mjs'), logLevel: 'silent' })
const App = await import(pathToFileURL(path.join(tmp, 'app.mjs')).href)

let failures = 0
let checks = 0
const check = (cond, msg, extra) => { checks++; if (!cond) { failures++; console.log(`  FAIL  ${msg}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`) } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const clean = (v) => !/undefined|NaN|\[object|null/.test(String(v))

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
} finally { relay.kill(); await sleep(200) }

const orders = JSON.parse(fs.readFileSync(path.join(dataDir, 'orders.json'), 'utf8'))
console.log(`${events.length} events, ${orders.length} orders from ${path.basename(logFile)}`)

// ── what the relay saves ─────────────────────────────────────────────────────────────────────────────
check(orders.length === 8 && orders.every(o => o.run_details), 'every order has run_details', orders.map(o => !!o.run_details))
const d = orders.map(o => o.run_details)
check(d.every(x => x.item_position_m && x.shelf_row && x.shelf_side && x.robot_clock_started_at), 'item position, shelf row and side, and the robot-clock start time on every order')
check(d[0].shelf_row === 'top' && d[0].shelf_side === 'left' && d[1].shelf_row === 'lower' && d[2].shelf_side === 'middle', 'shelf row and side come from the position', d.slice(0, 3).map(x => [x.shelf_row, x.shelf_side]))
check(d[0].item_position_m.z > 1.6 && d[0].item_position_m.y < -0.1, 'water bottle: top shelf, y -0.151', d[0].item_position_m)
check(d[0].attempts.map(a => a.outcome).join() === 'no_reachable_grip,grabbed', 'order 1: first try no reachable grip, second grabbed', d[0].attempts.map(a => a.outcome))
check(d[5].attempts.map(a => a.outcome).join() === 'no_reachable_grip,lift_failed_awkward_wrist,grabbed', 'order 6: no reachable grip, then the wrist problem at the lift, then grabbed', d[5].attempts.map(a => a.outcome))
check(d[1].attempts.length === 1 && d[1].attempts[0].outcome === 'grabbed' && !d[1].needed_more_than_one_try && d[0].needed_more_than_one_try, 'clean orders have one attempt; the retried ones say they needed more than one try')
const a2 = d[0].attempts[1]
check(a2.after_failure?.retry_number === 1 && a2.after_failure.retry_limit === 5 && a2.look_from.look_down_deg === 20 && a2.look_from.hand_position_m.z > d[0].attempts[0].look_from.hand_position_m.z, 'attempt 2 knows why it happened and where it looked from (higher up)', a2.after_failure)
check(a2.grasp_point_px?.length === 2 && a2.item_outline?.score > 0.8 && a2.item_outline.visible_area_px > 10000 && a2.grip_plan?.proposed_grips === 20, 'attempt 2: grasp point, item outline score and area, grip plan', [a2.grasp_point_px, a2.item_outline, a2.grip_plan])
check(d[0].grip?.width_mm === 85 && d[0].grip.hand_opening_mode === 'FULL' && d[0].planner_settings?.stop_in_front_mm === 120 && d[0].gripper_close_force === 1 && d[0].motion_speed_ceiling_x === 1, 'grip, planner settings, gripper force and speed ceiling', [d[0].grip, d[0].planner_settings])
check(d[0].target_candidates.length === 2 && d[0].item_search[0]?.shelf_name === 'right-shelve' && d[0].item_search[0].clusters_kept === 10, 'target candidates and what the search saw', [d[0].target_candidates, d[0].item_search[0]])
check(d[0].held_item_box_m?.length === 3 && d[0].handover?.arm_joint_angles_deg?.length === 6 && d[0].handover.person_position_m?.y < -1, 'held item box and the handover (person position, arm angles)')
const live = events.filter(e => e.type === 'run_details')
check(live.length > 20 && live.every(e => e.details), 'the relay sends the details to the dashboard as they grow', live.length)

// ── plain words ──────────────────────────────────────────────────────────────────────────────────────
const told1 = App.attempts.describeAttempts(d[0], 'water bottle')
check(told1.rows.length === 2 && told1.rows[0].label === 'Couldn’t reach it' && told1.rows[1].label === 'Got it', 'order 1 rows', told1.rows.map(r => r.label))
check(told1.rows[1].title === 'Second look, from higher up and a little to the left', 'attempt 2 is described by where it looked from, not by a viewpoint number', told1.rows[1].title)
check(/I found 20 ways to grip the water bottle, but my arm couldn’t reach any of them from there/.test(told1.rows[0].text), 'attempt 1 says what happened in plain words', told1.rows[0].text)
const told6 = App.attempts.describeAttempts(d[5], 'water bottle')
check(told6.rows[1].label === 'Couldn’t lift it' && /twisted my wrist/.test(told6.rows[1].text) && /much further to the left/.test(told6.rows[2].title), 'order 6: wrist wording and "much further to the left"', [told6.rows[1].text, told6.rows[2].title])
check(told6.summary === 'Got it on try 3. Try 1 couldn’t reach it and try 2 couldn’t lift it.', 'order 6 step summary', told6.summary)
check(told6.footer.some(f => /up to 5 times/.test(f)) && told6.footer.some(f => /further to the left than before/.test(f)), 'the footer says how many tries are allowed and what changed', told6.footer)
check(!/viewpoint|goalset|IK|candidate|pre-filter|chained|branch flip/i.test(JSON.stringify(told1.rows) + JSON.stringify(told6.rows)), 'no robot terms in the words')

// ── Live ─────────────────────────────────────────────────────────────────────────────────────────────
let state = App.liveInitialState
let cycle = 0
let mid = null, midCount = 0, heads = null, thinking = null
const slimOf = (o) => ({
  id: o.id, item: o.item, status: o.status, started_at: o.started_at, retries: o.retries || 0,
  item_position_m: o.run_details?.item_position_m ?? null, shelf_row: o.run_details?.shelf_row ?? null, shelf_side: o.run_details?.shelf_side ?? null,
  attempt_count: o.run_details?.attempt_count ?? null, needed_more_than_one_try: o.run_details?.needed_more_than_one_try ?? null,
})
let finished = []   // orders completed so far, as the history the dashboard would hold
for (const m of events) {
  state = App.liveReducer(state, { type: 'ws_message', message: m })
  if (m.type === 'cycle_start') { cycle++; state = { ...state }; }
  if (m.type === 'cycle_end') finished = orders.slice(0, cycle).map(slimOf)
  const rd = state._runDetails
  if (cycle === 1 && rd && !rd.shelf_row && !thinking) thinking = App.cf.liveCounterfactual(state, finished)
  // order 1, the second attempt under way
  if (cycle === 1 && rd?.attempts?.length === 2 && !rd.attempts[1].outcome && !mid) mid = state
  // order 6 (the second water bottle), at its first attempt and before it has failed
  if (cycle === 6 && rd?.shelf_row && rd.attempts?.length === 1 && !rd.attempts[0].outcome && !heads) heads = { state, history: finished.slice() }
}
check(thinking?.state === 'thinking' || thinking === null, 'before the item is located the card is "thinking"')
check(!!mid, 'caught order 1 with its second attempt under way')
if (mid) {
  const ns = App.deriveNowServing(mid, [], Date.now())
  check(ns.headline === 'My first try didn’t work: my arm couldn’t reach the water bottle from there. I’m trying again, from higher up and a little to the left.', 'Now serving says it in the words of the steps', ns.headline)
  check(ns.evidence[0].label === 'Try 1' && ns.evidence[0].value === 'Couldn’t reach it' && ns.evidence[1].value === 'Trying now' && ns.evidence.at(-1).label === 'Where it is' && ns.evidence.at(-1).value === 'Top shelf', 'evidence rows: Try 1, Try 2, Where it is', ns.evidence.map(e => [e.label, e.value]))
  const row = App.deriveSteps(mid, [], Date.now()).find(r => r.key === 'grasping')
  check(row.tries?.rows.length === 2 && row.tries.rows[1].label === 'Trying now' && row.summary === 'Try 1 couldn’t reach it. Try 2 is under way.' && row.badge === 'Trying again' && row.openDefault, 'the "Picking up" step shows My tries, opened', [row.summary, row.badge])
  check(clean(ns.headline) && ns.evidence.every(e => clean(e.value) && clean(e.note)), 'no junk in the Now serving words')
}
check(!!heads, 'caught order 6 before its first attempt finished')
if (heads) {
  const c = App.cf.liveCounterfactual(heads.state, heads.history)
  check(c.state === 'heads_up' && /needed a second try 1 time out of 1|needed a second try/.test(c.sentence) || c.state === 'unknown', 'before the pick-up: a heads-up (or "not enough orders" when only one similar order exists)', [c.state, c.sentence])
}
// after order 1 and 6 failed their first try, with the orders before: the counterfactual
const hist5 = orders.slice(0, 5).map(slimOf)
const after = { ...App.liveInitialState, _runDetails: { ...d[5], attempts: d[5].attempts.slice(0, 2).map((a, i) => (i === 1 ? { ...a, outcome: null } : a)) }, _itemName: 'water bottle', _cycleStartedAt: Date.now() }
const cfc = App.cf.liveCounterfactual(after, hist5)
check(cfc.state === 'nothing' || cfc.state === 'counterfactual', 'after a failed try: a counterfactual or "nothing to suggest"', cfc.state)
const hist7 = [...hist5, slimOf(orders[5])]
const cf8 = App.cf.orderCounterfactual({ ...orders[5], id: 999 }, hist7)
check(cf8?.state === 'counterfactual' && cf8.tiles[0].big === '2 of 2' && cf8.tiles[1].big === '2 of 2' && /helped every time so far/.test(cf8.sentence), 'with both water bottles known: "2 of 2 needed more than one try, 2 of 2 worked after a new angle"', [cf8?.state, cf8?.tiles?.map(t => t.big), cf8?.sentence])
check(cf8.map.dots.length === 6 && cf8.map.dots.filter(x => x.needed).length === 2 && cf8.caption.includes('6 orders'), 'the shelf map has the earlier orders and says how many it rests on', [cf8.map.dots.length, cf8.caption])
check(App.cf.orderCounterfactual(orders[1], hist7) === null, 'a clean first-try delivery gets no panel')
// a replay plays the same recorded orders again and again: they count once (told apart by the robot's own clock)
const withRobotClock = orders.map(o => ({ ...slimOf(o), robot_clock_started_at: o.run_details.robot_clock_started_at }))
const replayedThrice = [0, 1, 2].flatMap(loop => withRobotClock.map(r => ({ ...r, id: r.id + loop * 100, started_at: new Date(Date.now() + loop * 60000).toISOString() })))
const cfLoops = App.cf.orderCounterfactual({ ...orders[5], id: 999 }, replayedThrice)
check(cfLoops?.caption.includes('the 8 orders') && cfLoops.map.dots.length === 8 && cfLoops.tiles[0].big === '2 of 2', '24 replayed rows are 8 orders: the card counts 8, not 24', [cfLoops?.caption, cfLoops?.map.dots.length])
const old = App.cf.counterfactualCard({ spot: { row: 'top', side: 'left', position: { y: -0.15 } }, attempts: { failedSoFar: true }, history: hist7.map(r => ({ ...r, started_at: '2026-06-04T10:00:00Z' })) })
check(old.state === 'nothing', 'orders from before the setup changed are not used', old.state)

// ── History drawer rows ──────────────────────────────────────────────────────────────────────────────
const rows = App.orderSteps.deriveOrderSteps({ ...orders[5], phases: orders[5].steps }, orders)
const pick = rows.find(r => r.key === 'grasping')
check(pick.tries?.rows.length === 3 && pick.summary === 'Got it on try 3. Try 1 couldn’t reach it and try 2 couldn’t lift it.' && pick.openDefault && !pick.attempts, 'History: "Picking up" shows My tries for the order', [pick.summary])
check(!App.orderSteps.deriveOrderSteps({ ...orders[1], phases: orders[1].steps }, orders).find(r => r.key === 'grasping').tries, 'History: a clean order has no tries section')

console.log(`\n${checks - failures}/${checks} checks passed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failures ? 1 : 0)
