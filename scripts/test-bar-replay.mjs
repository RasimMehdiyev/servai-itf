/**
 * The bartender robot end to end, against a recorded bar log.
 *
 *   node scripts/test-bar-replay.mjs [path/to/bar.log]      (default: scripts/fixtures/bar_demo_2026-10-21.log)
 *
 * 1. starts the relay with ROBOT=bar in replay mode, into a throw-away data folder that also holds
 *    a grocery orders.json (to prove the two robots' orders stay apart)
 * 2. collects the event stream over WebSocket
 * 3. feeds it through the Live reducer (the bar mapper) and the bar view builders
 * 4. checks the saved orders, the History step rows, the heatmap labels and the endpoints
 *
 * Exit code is non-zero if any check fails.
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const WebSocket = require('ws')

const logFile = path.resolve(process.argv[2] || path.join(ROOT, 'scripts/fixtures/bar_demo_2026-10-21.log'))
const PORT = 8792
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'servai-bar-'))
const dataDir = path.join(tmp, 'data')
fs.mkdirSync(dataDir, { recursive: true })
const grocerySeed = path.join(ROOT, 'data', 'orders.json')
if (fs.existsSync(grocerySeed)) fs.copyFileSync(grocerySeed, path.join(dataDir, 'orders.json'))
const sha = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : null)
const groceryHashBefore = sha(path.join(dataDir, 'orders.json'))

const entry = path.join(tmp, 'entry.js')
const fwd = (p) => JSON.stringify(path.join(ROOT, p).replace(/\\/g, '/'))
fs.writeFileSync(entry, `
export { liveReducer, initialStateFor } from ${fwd('src/services/liveState.js')}
export { deriveNowServing, deriveSteps, deriveLog } from ${fwd('src/lib/liveView.js')}
export { deriveOrderSteps, orderHeadline } from ${fwd('src/lib/orderSteps.js')}
export { barContextSentence } from ${fwd('src/robots/bar/view.js')}
export { PROFILES } from ${fwd('src/robots/profiles.js')}
export * as heat from ${fwd('src/lib/heatmap.js')}
export * as stats from ${fwd('src/lib/orderStats.js')}
export * as critic from ${fwd('src/lib/critic.js')}
`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: path.join(tmp, 'app.mjs'), logLevel: 'silent' })
const App = await import(pathToFileURL(path.join(tmp, 'app.mjs')).href)

let failures = 0
let checks = 0
function check(cond, msg, extra) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`) }
}
const clean = (v) => !/undefined|NaN|\[object|null/.test(String(v))

console.log(`Log file : ${logFile}`)
const server = spawn(process.execPath, [path.join(ROOT, 'ws-test-server.js')], {
  cwd: ROOT,
  env: { ...process.env, ROBOT: 'bar', STATIC_REPLAY: '1', REPLAY_LOG: logFile, DATA_DIR: dataDir, WS_PORT: String(PORT), REPLAY_SPEED: '400', REPLAY_ONCE: '1', REPLAY_START_DELAY: '1500' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let out = ''
let loopDone = false
server.stdout.on('data', (d) => { out += d; if (/Loop \d+ complete/.test(out)) loopDone = true })
server.stderr.on('data', (d) => { out += d })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function waitFor(fn, ms, label) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(100) }
  console.log(`  timeout waiting for ${label}`)
  return false
}

const events = []
let source = null
try {
  await waitFor(() => /WebSocket: ws/.test(out), 15000, 'server start')
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
  ws.on('message', (raw) => {
    const m = JSON.parse(raw)
    if (m.type === 'source_mode') { source = m; return }
    if (m.type === 'heartbeat') return
    events.push(m)
  })
  await waitFor(() => loopDone, 60000, 'replay loop to finish')
  await sleep(500)
  ws.close()

  console.log(`Collected ${events.length} events from the ${source?.robot} relay (mode: ${source?.mode})`)
  check(source?.robot === 'bar', 'the relay says it serves the bar', source)
  const types = events.reduce((m, e) => (m[e.type] = (m[e.type] || 0) + 1, m), {})
  console.log('  event types:', JSON.stringify(types))
  check(types.cycle_start === 2 && types.cycle_end === 2, 'two drink cycles in the log', [types.cycle_start, types.cycle_end])
  check(types.rack_scan === 1, 'the rack scan arrives as its own event', types.rack_scan)

  // ── Live reducer, drink by drink ────────────────────────────────────────────
  let state = App.initialStateFor('bar')
  check(state._robot === 'bar', 'the bar starts from its own initial state')
  const history = []
  let cur = null
  const drinks = []
  for (const m of events) {
    if (m.type === 'cycle_start') cur = { n: m.cycleNum, events: [] }
    if (cur) cur.events.push(m)
    state = App.liveReducer(state, { type: 'ws_message', message: m, robot: 'bar' })

    if (cur && m.type === 'phase') {
      const ns = App.deriveNowServing(state, history, Date.now())
      const steps = App.deriveSteps(state, history, Date.now())
      for (const k of ['headline', 'phaseLabel', 'next', 'ifWrong']) check(clean(ns[k]), `mid-drink ${k} reads cleanly (drink ${cur.n})`, ns[k])
      check(steps.length === 6, 'six bar steps', steps.map(s => s.key))
      // the empty rack from drink 1 is remembered while drink 2 runs (the cycles touch: no gap to show it in)
      if (cur.n === 2 && ns.isActive) {
        check(ns.pillText === 'Refill needed' && ns.actions?.primary?.id === 'refilled', 'drink 2: still asks for a refill while pouring', [ns.pillText, ns.actions])
        check(ns.issues.some(i => /out of bottles after the last drink/.test(i.text)), 'drink 2: the carried note is listed as an issue', ns.issues)
        check(!steps.some(s => s.state === 'activeWarn'), 'drink 2: the carried note does not turn the running step amber', steps.map(s => s.state))
      }
      check(steps.filter(s => s.state === 'active' || s.state === 'activeWarn').length <= 1, 'at most one running step', steps.map(s => s.key + ':' + s.state))
    }

    if (m.type === 'cycle_end' && cur) {
      const ns = App.deriveNowServing(state, history, Date.now())
      const steps = App.deriveSteps(state, history, Date.now())
      const ev = state._ev
      const states = steps.map(s => s.state)
      const idx = drinks.length

      check(ev.bottle === idx, `drink ${cur.n}: bottle ${idx} read from the rack hole`, ev.bottle)
      check(ev.glassesFilled === 1 && ev.glasses === 1, `drink ${cur.n}: glass 1 of 1 filled`, [ev.glassesFilled, ev.glasses])
      check(ev.poured === 0.2, `drink ${cur.n}: poured 0.2`, ev.poured)
      check(ev.decapSkipped && ev.shakeUnsafe && !ev.customer, `drink ${cur.n}: decap skipped, shake unsafe, no customer`, ev)
      check(ev.refillNeeded, `drink ${cur.n}: rack out of bottles noticed`)
      check(ev.rackBottles === 2 && ev.rackCapped === 0, `drink ${cur.n}: rack scan carried into the drink`, [ev.rackBottles, ev.rackCapped])
      check(states[0] === 'warn' && states.slice(1, 5).every(s => s === 'done') && states[5] === 'warn', `drink ${cur.n}: step 1 amber (shake skipped), steps 2-5 done, the last one amber`, states)
      check(steps[0].badge === 'Shake skipped', `drink ${cur.n}: step 1 badge says shake skipped`, steps[0].badge)
      check(steps[5].badge === 'Refill needed', `drink ${cur.n}: last step badge says refill needed`, steps[5].badge)
      check(ns.waiting && ns.cardState === 'red', `drink ${cur.n}: Now serving asks for a refill`, [ns.waiting, ns.cardState])
      check(ns.pillText === 'Refill needed', `drink ${cur.n}: pill says refill needed`, ns.pillText)
      check(ns.actions?.primary?.id === 'refilled', `drink ${cur.n}: primary action is "I've refilled the rack"`, ns.actions)
      check(/out of bottles/i.test(ns.headline) && /200 ml/.test(ns.headline), `drink ${cur.n}: headline says 200 ml were poured and the rack is empty`, ns.headline)
      check(ns.evidence.length >= 2 && ns.evidence.every(e => clean(e.value) && clean(e.note)), `drink ${cur.n}: evidence rows are clean`, ns.evidence)
      check(ns.phaseLabel.startsWith('Finished all 6 steps'), `drink ${cur.n}: phase label`, ns.phaseLabel)
      check(state._log.length >= 8 && state._log.every(r => clean(r.plain) && r.plain.length > 3), `drink ${cur.n}: plain-words log reads cleanly`, state._log.map(r => r.plain).slice(0, 3))
      check(state._log.some(r => /unsafe to shake/i.test(r.plain)) && state._log.some(r => /out of bottles/i.test(r.plain)), `drink ${cur.n}: shake and refill lines are in plain words`)
      check(state._log.every(r => /^(BARISTA:|DECAP|POUR|CYCLE|cycle|object)/.test(r.raw) || r.raw.length > 0), `drink ${cur.n}: raw lines keep the robot's own names`)
      check(steps.every(s => clean(s.summary) && clean(s.dur) && clean(s.typ)), `drink ${cur.n}: step text reads cleanly`)
      drinks.push({ n: cur.n, states: states.map(s => s[0]).join(''), headline: ns.headline.slice(0, 60) })
      cur = null
    }
  }
  console.log('\n  drink  steps    headline')
  for (const d of drinks) console.log(`  ${String(d.n).padEnd(5)}  ${d.states.padEnd(7)}  ${d.headline}`)

  // ── the saved orders ─────────────────────────────────────────────────────────
  const barFile = path.join(dataDir, 'orders_bar.json')
  const saved = JSON.parse(fs.readFileSync(barFile, 'utf8'))
  console.log(`\nSaved bar orders: ${saved.length} in orders_bar.json`)
  check(saved.length >= 2, 'bar orders were saved', saved.length)
  check(saved.every(o => o.robot === 'bar' && o.robot_id === 'BAR' && o.item === 'bottle'), 'every order is a bar order of item "bottle"')
  check(saved.every(o => o.status === 'warning' && o.failure?.reason === 'bottles_empty' && o.failure?.at_phase === 'return'), 'each drink is saved as "warning: bottles_empty at return"', saved[0]?.failure)
  check(saved.every(o => o.glasses_filled === 1 && o.poured === 0.2 && o.rack_bottles === 2 && o.decap_skipped && o.shake_unsafe), 'orders carry glass, pour, rack and decap facts', saved[0])
  check(saved.every(o => ['decap', 'track', 'glass', 'grab', 'pour', 'return'].every(p => o.steps.some(s => s.phase === p))), 'every order has all six bar steps')
  check(saved[0].bottle === 0 && saved[1].bottle === 1, 'the first two drinks used bottles 0 and 1', [saved[0].bottle, saved[1].bottle])
  check(sha(path.join(dataDir, 'orders.json')) === groceryHashBefore, 'the grocery orders.json was not touched')

  // ── the AI Judge: the vision-language model that ruled on shaking ─────────
  const judgeEv = events.filter(e => e.type === 'critic')
  check(judgeEv.length === 2 && judgeEv.every(e => e.kind === 'verdict' && e.topic === 'shake' && e.verdict === 'unsafe_to_shake'), 'two judge verdicts: not safe to shake', judgeEv.map(e => [e.kind, e.verdict]))
  check(judgeEv[0].bottle === 0 && judgeEv[1].bottle === 1, 'each verdict names its bottle', judgeEv.map(e => e.bottle))
  check(saved.every(o => o.critic?.verdict === 'unsafe_to_shake' && o.critic.topic === 'shake'), 'each order keeps the judge\'s verdict', saved.map(o => o.critic?.verdict))
  check(saved[0].critic.bottle === 0 && saved[1].critic.bottle === 1, 'the verdict belongs to the drink it was about', saved.map(o => o.critic?.bottle))
  for (const o of saved) {
    const v = App.critic.orderCriticView(o)
    check(v?.mode === 'unsafe_to_shake' && v.tone === 'warn' && new RegExp(`I think it is not safe to shake bottle ${o.bottle + 1}`).test(v.line), `order ${o.id}: judge box says "I think it is not safe to shake bottle ${o.bottle + 1}"`, v?.line)
    const decap = App.deriveOrderSteps(o, saved)[0]
    check(decap.judge?.tone === 'warn' && /not safe to shake/.test(decap.judge.text), `order ${o.id}: the first step carries the judge's note`, decap.judge)
    check(!decap.summary.includes('I think'), `order ${o.id}: the step itself does not repeat the judge's words`, decap.summary)
  }

  // ── History drawer + stats ───────────────────────────────────────────────────
  let rowCount = 0
  for (const o of saved) {
    const rows = App.deriveOrderSteps(o, saved)
    rowCount += rows.length
    check(rows.length === 6 && rows.every(r => r.state !== 'pending'), `order ${o.id}: six reached step rows`, rows.map(r => r.state))
    check(rows[0].state === 'warn' && rows[0].badge === 'Shake skipped', `order ${o.id}: first row amber, "Shake skipped"`, [rows[0].state, rows[0].badge])
    check(rows[5].state === 'warn' && rows[5].badge === 'Refill needed', `order ${o.id}: last row amber, "Refill needed"`, [rows[5].state, rows[5].badge])
    check(rows.every(r => clean(r.summary) && clean(r.dur) && clean(r.typ) && clean(r.why)), `order ${o.id}: rows read cleanly`)
    check(/200 ml/.test(App.orderHeadline(o)) && /drink itself is fine/i.test(App.orderHeadline(o)) && /out of bottles/i.test(App.orderHeadline(o)), `order ${o.id}: headline says 200 ml were poured and only the rack needs a refill`, App.orderHeadline(o))
  }
  console.log(`History drawer: ${saved.length} orders → ${rowCount} step rows`)
  const P = App.PROFILES.bar
  check(!P.hasItemFilter, 'the bar has no item filter')
  check(P.itemText({ bottle: 0 }) === 'Bottle 1' && P.itemText({ bottle: 1 }) === 'Bottle 2', 'bottle labels count from 1', [P.itemText({ bottle: 0 }), P.itemText({ bottle: 1 })])
  check(P.needHelp({ failed: 0, warning: 3 }) === 3, 'a drink with the rack empty counts as "needed help"')
  console.log('  ' + App.barContextSentence(saved))

  // ── heatmap with the bar's labels ────────────────────────────────────────────
  const H = App.heat
  const day = (() => { const d = new Date(saved[0].started_at); return H.ymd(d) })()
  const hm = H.buildHeatmap({ rows: saved.map(o => ({ t: o.started_at, s: o.status })), from: day, to: day, labels: P.labels })
  check(hm.rows.map(r => r.label).join('|') === `${P.labels.delivered}|${P.labels.warning}|${P.labels.failed}`, 'heatmap rows use the bar wording', hm.rows.map(r => r.label))
  check(hm.rows[1].total === String(saved.length), 'all drinks land in the "needs attention" row', hm.rows[1].total)

  // ── endpoints ───────────────────────────────────────────────────────────────
  const get = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json()
  const src = await get('/api/source')
  check(src.robot === 'bar', '/api/source names the bar', src)
  const ro = await get('/api/recent-orders')
  check(ro.total === saved.length && ro.today.warning === saved.length && ro.today.total === saved.length, 'recent-orders counts only bar orders', [ro.total, ro.today])
  const list = await get(`/api/orders/list?from=${day}&to=${day}`)
  check(list.orders.length === saved.length && list.counts.warning === saved.length, 'orders list reads orders_bar.json', list.counts)
  const slim = await get('/api/orders/slim')
  check(slim.length === saved.length, 'slim history reads orders_bar.json', slim.length)
} finally {
  server.kill()
  await sleep(200)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failures ? 1 : 0)
