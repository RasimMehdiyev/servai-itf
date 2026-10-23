/**
 * Does a robot log work with the dashboard?
 *
 *   node scripts/check-log-compat.mjs scripts/fixtures/orchestrator_2026-10-20.log
 *
 * Runs every line through the relay's own parseLine(), then the resulting events
 * through the Live reducer, and reports which lines were understood, which were
 * dropped, and what the Live page would show at the end of each order.
 * Lines are tried as they are and with a "[process] " prefix removed.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.resolve(process.argv[2] || path.join(ROOT, 'scripts/fixtures/orchestrator_2026-10-20.log'))

// parseLine lives inside the relay (no exports, starts a server on load), so lift just the parser
const src = fs.readFileSync(path.join(ROOT, 'ws-test-server.js'), 'utf8')
const a = src.indexOf('const _parserState')
const b = src.indexOf('// ── Batch file parser')
const sandbox = { ROBOT_ID: process.env.ROBOT || 'grocery' }   // the parser tells the robots' cycle lines apart
vm.createContext(sandbox)
vm.runInContext(src.slice(a, b) + '\nthis.parseLine = parseLine; this.state = _parserState', sandbox)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'servai-compat-'))
const entry = path.join(tmp, 'entry.js')
const fwd = (p) => JSON.stringify(path.join(ROOT, p).replace(/\\/g, '/'))
fs.writeFileSync(entry, `
export { liveReducer, liveInitialState } from ${fwd('src/services/liveState.js')}
export { deriveNowServing, deriveSteps, deriveLog } from ${fwd('src/lib/liveView.js')}
`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: path.join(tmp, 'app.mjs'), logLevel: 'silent' })
const App = await import(pathToFileURL(path.join(tmp, 'app.mjs')).href)

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim())
const stripPrefix = (l) => l.replace(/^\[[\w-]+\]\s+/, '')

function run(label, transform) {
  sandbox.state.lastTimestamp = null
  const events = []
  const dropped = []
  for (const raw of lines) {
    const evt = sandbox.parseLine(transform(raw))
    if (evt) events.push({ evt, raw }); else dropped.push(raw)
  }
  const byType = {}
  for (const { evt } of events) byType[evt.type] = (byType[evt.type] || 0) + 1
  console.log(`\n── ${label}`)
  console.log(`   ${lines.length} lines → ${events.length} events understood, ${dropped.length} dropped`)
  console.log('   event types:', JSON.stringify(byType))
  return { events, dropped }
}

const asIs = run('lines exactly as pasted', l => l)
const stripped = run('with the "[process] " prefix removed', stripPrefix)

// What does the relay see among the dropped lines once the prefix is gone?
const meaningful = stripped.dropped.filter(l => /\| (WORKFLOW|SYSTEM) \|/.test(l) || /plan=LERP/.test(l))
if (meaningful.length) {
  console.log('\n   still dropped after stripping (orchestrator lines):')
  for (const l of meaningful.slice(0, 12)) console.log('    ' + l.slice(0, 170))
}

// Replay the prefix-stripped events through the Live reducer
console.log('\n── Live page after replaying the events (prefix removed)')
let state = App.liveInitialState
let n = 0
for (const { evt } of stripped.events) {
  state = App.liveReducer(state, { type: 'ws_message', message: evt })
  if (evt.type === 'cycle_end' || evt.type === 'cycle_start' || evt.type === 'object_selected') {
    console.log(`   after ${evt.type}${evt.objectName ? ' ' + evt.objectName : ''}: card=${state._cardState} title="${state.attentionTitle}" text="${(state.explanationText || '').slice(0, 80)}"`)
  }
  n++
}
const ns = App.deriveNowServing(state, [], Date.now())
const steps = App.deriveSteps(state, [], Date.now())
console.log(`\n   item: ${state._itemName}   headline: ${ns.headline}`)
console.log('   steps:', steps.map(s => `${s.title}=${s.state}${s.secs != null ? '(' + s.secs + 's)' : ''}`).join(' | '))
console.log('   evidence:', JSON.stringify(state._ev && { places: state._ev.places, anchor: state._ev.anchor, refine: state._ev.refine, depth: state._ev.depth, width: state._ev.width, goalset: state._ev.goalset, tries: state._ev.tries.map(t => t.result) }))
console.log('   technical details:', JSON.stringify(state.robotParams?.params?.map(p => `${p.label}: ${p.value}`) ?? null))
console.log('   plain-words log:')
for (const l of App.deriveLog(state, 20).reverse()) console.log(`     ${l.tone.padEnd(4)} ${l.plain}`)

fs.rmSync(tmp, { recursive: true, force: true })
