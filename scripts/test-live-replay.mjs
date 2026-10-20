/**
 * End-to-end check of the Live page logic against recorded robot logs.
 *
 *   node scripts/test-live-replay.mjs [path/to/log.txt]      (default: grocery_logs.txt)
 *
 * 1. starts the real relay (ws-test-server.js) in replay mode, writing into a
 *    throw-away data folder seeded with a copy of data/orders.json
 * 2. connects over WebSocket and collects the event stream
 * 3. feeds every event through the same reducer the UI uses (liveReducer)
 * 4. after each order, builds the view models (Now serving, pipeline, log) and
 *    checks them against what the raw events say
 * 5. checks the HTTP endpoints behind "Today so far" and the History heatmap
 *
 * Exit code is non-zero if any check fails.
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

const logFile = path.resolve(process.argv[2] || path.join(ROOT, 'grocery_logs.txt'))
const PORT = 8791
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'servai-replay-'))
const dataDir = path.join(tmp, 'data')
fs.mkdirSync(dataDir, { recursive: true })
const seed = process.env.SEED_ORDERS || path.join(ROOT, 'data', 'orders.json')
if (fs.existsSync(seed)) fs.copyFileSync(seed, path.join(dataDir, 'orders.json'))

// ── bundle the app logic (ESM, no React) so Node can run it ──────────────────
const entry = path.join(tmp, 'entry.js')
fs.writeFileSync(entry, `
export { liveReducer, liveInitialState } from ${JSON.stringify(path.join(ROOT, 'src/services/liveState.js').replace(/\\/g, '/'))}
export { deriveNowServing, deriveSteps, deriveLog } from ${JSON.stringify(path.join(ROOT, 'src/lib/liveView.js').replace(/\\/g, '/'))}
export * as stats from ${JSON.stringify(path.join(ROOT, 'src/lib/orderStats.js').replace(/\\/g, '/'))}
export * as heat from ${JSON.stringify(path.join(ROOT, 'src/lib/heatmap.js').replace(/\\/g, '/'))}
export * as translate from ${JSON.stringify(path.join(ROOT, 'src/lib/logTranslate.js').replace(/\\/g, '/'))}
`)
const bundle = path.join(tmp, 'app.mjs')
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent' })
const App = await import(pathToFileURL(bundle).href)

// ── tiny assertion helpers ───────────────────────────────────────────────────
let failures = 0
let checks = 0
function check(cond, msg, extra) {
  checks++
  if (!cond) {
    failures++
    console.log(`  FAIL  ${msg}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`)
  }
}
const clean = (v) => !/undefined|NaN|\[object|null/.test(String(v))

// ── run the relay ────────────────────────────────────────────────────────────
console.log(`Log file : ${logFile}`)
console.log(`Data dir : ${dataDir}`)
const server = spawn(process.execPath, [path.join(ROOT, 'ws-test-server.js')], {
  cwd: ROOT,
  env: { ...process.env, STATIC_REPLAY: '1', REPLAY_LOG: logFile, DATA_DIR: dataDir, WS_PORT: String(PORT), REPLAY_SPEED: '400' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverOut = ''
let loopDone = false
server.stdout.on('data', (d) => { serverOut += d; if (/Loop \d+ complete/.test(serverOut)) loopDone = true })
server.stderr.on('data', (d) => { serverOut += d })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function waitFor(fn, ms, label) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(100) }
  console.log(`  timeout waiting for ${label}`)
  return false
}

const events = []
let sourceMode = null
try {
  await waitFor(() => /WebSocket: ws/.test(serverOut), 15000, 'server start')
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
  ws.on('message', (raw) => {
    const m = JSON.parse(raw)
    if (m.type === 'source_mode') { sourceMode = m.mode; return }
    if (m.type === 'heartbeat') return
    events.push(m)
  })
  await waitFor(() => loopDone, 120000, 'replay loop to finish')
  await sleep(500)
  ws.close()

  console.log(`\nCollected ${events.length} events (relay mode: ${sourceMode})`)
  check(sourceMode === 'static', 'relay reports static replay mode', sourceMode)
  check(events.length > 100, 'enough events collected', events.length)

  // ── feed the reducer, one order at a time ──────────────────────────────────
  let state = App.liveInitialState
  const history = JSON.parse(fs.readFileSync(path.join(dataDir, 'orders.json'), 'utf8'))
  const cycles = []
  let cur = null
  let eventsInCycle = []

  for (const m of events) {
    if (m.type === 'cycle_start') { cur = { num: m.cycleNum, events: [] }; eventsInCycle = cur.events }
    if (cur) eventsInCycle.push(m)
    state = App.liveReducer(state, { type: 'ws_message', message: m })

    // mid-cycle snapshot: view models must never throw or print junk
    if (cur && m.type === 'phase' && state._itemName) {
      const now = Date.now()
      const ns = App.deriveNowServing(state, history, now)
      const st = App.deriveSteps(state, history, now)
      for (const k of ['headline', 'phaseLabel', 'next', 'ifWrong', 'context']) check(clean(ns[k]), `mid-cycle ${k} has no junk (cycle ${cur.num})`, ns[k])
      for (const r of st) for (const k of ['summary', 'dur', 'typ']) check(clean(r[k]), `mid-cycle step ${r.key}.${k} has no junk`, r[k])
      check(!st.some(s => s.state === 'fail') || state._cardState === 'red', `no step shown failed while the order is not red (cycle ${cur.num})`, st.map(s => s.key + ':' + s.state))
      check(st.filter(s => s.state === 'active').length <= 1, `at most one blue active step (cycle ${cur.num})`, st.map(s => s.key + ':' + s.state))
    }

    if (m.type === 'cycle_end' && cur) {
      const now = Date.now()
      const ns = App.deriveNowServing(state, history, now)
      const steps = App.deriveSteps(state, history, now)
      const ev = state._ev
      const raw = cur.events
      const rawTries = raw.filter(e => e.type === 'phase' && e.component === 'EXECUTE_GRASP' && e.status === 'BEGIN').length
      const rawRetries = raw.filter(e => e.type === 'phase' && e.component === 'CLOSEUP_RETRY' && e.status === 'BEGIN').length
      const rawCollisions = raw.filter(e => e.type === 'collision_warning').length
      const failed = m.outcome === 'FAIL'
      if (state._isAnomaly) { check(steps.length === 0, `cycle ${cur.num}: skipped (not in stock) order shows no pipeline`); cur = null; continue }
      const states = steps.map(s => s.state)

      check(ev.tries.length === rawTries, `cycle ${cur.num}: grasp tries match the log`, [ev.tries.length, rawTries])
      check(ev.retriesUsed <= rawRetries, `cycle ${cur.num}: retries used within the log`, [ev.retriesUsed, rawRetries])
      check(ev.collisions === rawCollisions, `cycle ${cur.num}: collision warnings match the log`, [ev.collisions, rawCollisions])
      check(ev.tries.every(t => t.result !== 'running'), `cycle ${cur.num}: no grasp try left "running" after the cycle ended`, ev.tries.map(t => t.result))
      if (failed) {
        check(states.includes('fail'), `cycle ${cur.num}: a failed step is shown`, states)
        check(ns.phaseLabel.startsWith('Stopped at step'), `cycle ${cur.num}: phase label says where it stopped`, ns.phaseLabel)
        check(!states.includes('active'), `cycle ${cur.num}: nothing still "active" after a failure`, states)
        check(ns.waiting, `cycle ${cur.num}: Now serving shows the waiting-for-you state`)
        check(ns.eta.label === 'Waiting for you', `cycle ${cur.num}: ETA slot says waiting for you`, ns.eta)
        check(ns.next.length > 0 && ns.ifWrong.length > 0, `cycle ${cur.num}: failure has a what-to-check line`, [ns.next, ns.ifWrong])
      } else {
        check(states.every(s => s === 'done'), `cycle ${cur.num}: every step done after success`, states)
        check(!ns.waiting, `cycle ${cur.num}: not waiting after success`)
      }
      check(ns.seg.length === steps.length, `cycle ${cur.num}: one segment per step`, [ns.seg.length, steps.length])
      check(state._log.length > 0, `cycle ${cur.num}: plain-words log has rows`)
      for (const r of state._log) { check(clean(r.plain) && r.plain.length > 3, `cycle ${cur.num}: log row reads cleanly`, r.plain) }
      for (const s of steps) {
        check(clean(s.summary) && clean(s.dur) && clean(s.typ), `cycle ${cur.num}: step ${s.key} text is clean`, [s.summary, s.dur, s.typ])
        if (s.state === 'done' && s.key !== 'scene_scan') check(s.secs != null && s.secs >= 0, `cycle ${cur.num}: done step ${s.key} has a duration`, s.secs)
      }
      const item = state._itemName
      cycles.push({
        n: cur.num, item, outcome: m.outcome,
        tries: ev.tries.length, blocked: ev.tries.filter(t => t.result === 'blocked').length,
        retries: ev.retriesUsed, places: ev.places.map(p => p.wp + (p.found ? '✓' : '✗')).join(' '),
        collisions: ev.collisions, steps: states.map(s => s[0]).join(''),
        headline: ns.headline.slice(0, 70),
      })
      cur = null
    }
  }

  console.log(`\nReplayed ${cycles.length} orders through the Live reducer:\n`)
  console.log('  #  item          outcome  tries(blocked) retries  steps     places')
  for (const c of cycles) {
    console.log(`  ${String(c.n).padEnd(2)} ${String(c.item).padEnd(13)} ${c.outcome.padEnd(8)} ${String(c.tries).padStart(2)}(${c.blocked})        ${c.retries}        ${c.steps.padEnd(9)} ${c.places}`)
  }

  // ── pure helpers against the real order history ────────────────────────────
  const S = App.stats
  const ts = S.itemStats(history, 't-shirt')
  console.log(`\nHistory (${history.length} orders):`)
  console.log('  ' + S.contextSentence(history, 't-shirt'))
  console.log('  ' + S.contextSentence(history, 'water bottle'))
  console.log('  ' + S.contextSentence(history, 'pen', 2))
  check(ts.n === history.filter(o => o.item === 't-shirt').length, 'item stats count matches the file')
  check(S.typicalStepSeconds(history).searching > 0, 'typical step durations computed')
  check(S.etaSeconds(history, 'pen', 10) > 0, 'ETA from history for pen')
  check(S.etaSeconds(history, 'unicorn', 10) === null, 'no ETA when history is too thin')

  // ── translator on every distinct raw failure text in the real orders ───────
  const details = [...new Set(history.map(o => o.failure?.detail).filter(Boolean))]
  let translated = 0
  for (const d of details) if (App.translate.translateFault(d)) translated++
  console.log(`\nFault translator: ${translated} of ${details.length} distinct failure texts have a plain-words version`)
  const hw = details.filter(d => /contact_stop|safety_clamp|first knot|branch flip/.test(d))
  check(hw.every(d => App.translate.translateFault(d)), 'all controller/IK error texts are translated', hw.filter(d => !App.translate.translateFault(d)).slice(0, 2))

  // ── HTTP endpoints behind Today so far and the heatmap ─────────────────────
  const get = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json()
  const written = JSON.parse(fs.readFileSync(path.join(dataDir, 'orders.json'), 'utf8'))
  const lastDay = written[written.length - 1].started_at
  const d = new Date(lastDay)
  const dayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const ro = await get(`/api/recent-orders?date=${dayStr}`)
  const expected = S.dayStats(written, dayStr)
  console.log(`\n/api/recent-orders?date=${dayStr}: today =`, JSON.stringify({ total: ro.today.total, delivered: ro.today.delivered, warning: ro.today.warning, failed: ro.today.failed, avg: ro.today.avg_seconds }))
  check(ro.today.total === expected.total, 'Today so far: total matches orders.json', [ro.today.total, expected.total])
  check(ro.today.delivered === expected.delivered && ro.today.warning === expected.warning && ro.today.failed === expected.failed, 'Today so far: outcome split matches', [ro.today, expected])
  check(ro.today.total === ro.today.delivered + ro.today.warning + ro.today.failed, 'Today so far: outcomes add up to the total')
  check(ro.today.recent.length === Math.min(2, ro.today.total), 'Today so far: two most recent orders')
  const times = await get(`/api/orders/times?from=${dayStr}&to=${dayStr}`)
  check(times.orders.length >= expected.total, 'heatmap endpoint returns the day’s orders', [times.orders.length, expected.total])

  // ── History heatmap against the real order history ─────────────────────────
  {
    const H = App.heat
    const all = written
    const lastDayStr = dayStr
    const back = (n) => { const x = H.parseDay(lastDayStr); x.setDate(x.getDate() - n); return H.ymd(x) }
    const rowsAll = all.map(o => ({ t: o.started_at, s: o.status }))
    const ranges = { today: [lastDayStr, lastDayStr], week: [back(6), lastDayStr], month: [back(29), lastDayStr], custom: [back(13), lastDayStr] }
    console.log('\nHeatmap (local-time buckets):')
    for (const [name, [from, to]] of Object.entries(ranges)) {
      const expected = rowsAll.filter(r => { const d = H.ymd(new Date(r.t)); return d >= from && d <= to })
      const exp = { n: expected.length, f: expected.filter(r => r.s === 'failed').length }
      for (const metric of ['orders', 'rate']) {
        const model = H.buildHeatmap({ rows: rowsAll, from, to, metric })
        if (metric === 'orders') {
          const sum = model.rows.reduce((a, r) => a + parseInt(r.total, 10), 0)
          check(sum === exp.n, `heatmap ${name}: cell totals add up to the orders in range`, [sum, exp.n])
          const cellSum = model.rows.reduce((a, r) => a + r.cells.reduce((b, c) => b + (c.key ? model.info[c.key].n : 0), 0), 0)
          // the one-day view repeats each hour in three outcome rows
          check(cellSum === exp.n * (model.kind === 'hours' ? 3 : 1), `heatmap ${name}: info counts add up`, [cellSum, exp.n])
        }
        check(model.bestKey === null || !!model.info[model.bestKey], `heatmap ${name}/${metric}: default selection exists`, model.bestKey)
        const r = model.bestKey ? H.readout(model, model.bestKey, metric) : null
        if (r) check(r.title && !/undefined|NaN/.test(r.big + r.sub + r.title), `heatmap ${name}/${metric}: readout is clean`, r)
        if (metric === 'rate' && model.kind !== 'hours') {
          const bad = model.rows.flatMap(rw => rw.cells).filter(c => c.key && model.info[c.key].n < H.MIN_RATE_ORDERS && c.bg !== H.NEUTRAL)
          check(bad.length === 0, `heatmap ${name}: rates under ${H.MIN_RATE_ORDERS} orders are greyed out`, bad.length)
        }
      }
      const m = H.buildHeatmap({ rows: rowsAll, from, to, metric: 'orders' })
      console.log(`  ${name.padEnd(7)} ${from}..${to}  kind=${m.kind.padEnd(8)} orders=${String(exp.n).padStart(3)} failed=${String(exp.f).padStart(3)}  rows=${m.rows.length} cols=${m.heads.length - 2}  busiest: ${m.info[m.bestKey]?.title}`)
    }
  }

  // replay wrote new orders into the throw-away folder only
  const original = fs.existsSync(seed) ? JSON.parse(fs.readFileSync(seed, 'utf8')).length : 0
  console.log(`\nOrders in throw-away data dir: ${written.length} (seed ${original}, +${written.length - original} from the replay)`)
} finally {
  server.kill()
  await sleep(200)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failures ? 1 : 0)
