/**
 * Prototype: "what could have changed this?" from the orders we have. Offline, nothing in the dashboard uses it yet.
 *
 *   node scripts/counterfactuals.mjs [orders.json] [--order <id>] [--json]
 *
 * 1. FEATURES      one row per order from what was known before the outcome: item, shelf where it was found,
 *                  match score and distance, grasp-point score, visible area, depth, grip width
 * 2. DOES IT HOLD? for each feature, how well it separates delivered from not delivered *within the same item and the
 *                  same day* (a "session"). Without that, "pens fail more than bottles", or "the day the shelf was
 *                  rearranged went badly", masquerades as "low scores fail more". An AUC of 0.5 is a coin toss; the
 *                  dashboard should only talk about features that clear a bar.
 * 3. STATEMENTS    for a failed order: among orders of the same item and session, the ones whose value was better than
 *                  this order's vs the ones like it, with counts and a confidence range. No statement without enough
 *                  orders. Features that only exist because the order already went wrong (shelves searched, retries,
 *                  collisions) are left out on purpose.
 *
 * "Delivered" = status success. Warnings and failures count as "not delivered cleanly".
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const file = path.resolve(args.find(a => a.endsWith('.json')) || path.join(ROOT, 'data/orders.json'))
const onlyOrder = args.includes('--order') ? Number(args[args.indexOf('--order') + 1]) : null
const asJson = args.includes('--json')

const MIN_GROUP = 8          // orders needed on each side of a comparison
const MIN_GAP = 0.25         // success-rate difference worth mentioning
const orders = JSON.parse(fs.readFileSync(file, 'utf8'))
  .filter(o => !['operator_abort', 'user_cancelled'].includes(o.failure?.reason))

// ── 1. features ─────────────────────────────────────────────────────────────────
const metaOf = (o, key) => {
  for (const s of o.steps || []) if (s.meta && s.meta[key] != null) return s.meta[key]
  return null
}
const FEATURES = {
  match_score:   { label: 'target match score', better: 'higher', get: o => metaOf(o, 'anchor_score') },
  match_dist_cm: { label: 'distance to the target (cm)', better: 'either', get: o => metaOf(o, 'anchor_distance_cm') },
  grasp_score:   { label: 'grasp-point score', better: 'higher', get: o => metaOf(o, 'refine_score') },
  visible_px:    { label: 'visible area of the item (px)', better: 'higher', get: o => metaOf(o, 'refine_area_px') },
  depth_m:       { label: 'measured depth (m)', better: 'either', get: o => metaOf(o, 'depth_m') },
  grip_mm:       { label: 'grip width (mm)', better: 'either', get: o => o.grasp_width_mm || null },
}
const rows = orders.map(o => ({
  id: o.id, item: o.item, ok: o.status === 'success', status: o.status, reason: o.failure?.reason || null,
  shelf: o.waypoint_found_at || null, day: (o.started_at || '').slice(0, 10),
  f: Object.fromEntries(Object.entries(FEATURES).map(([k, d]) => [k, d.get(o)])),
}))

// ── helpers ─────────────────────────────────────────────────────────────────────
function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1]
  const p = k / n, d = 1 + z * z / n
  const c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
  return [(c - m) / d, (c + m) / d]
}
const pct = (x) => `${Math.round(x * 100)}%`
function auc(pos, neg) {      // chance that a delivered order has the higher value than a not-delivered one
  if (!pos.length || !neg.length) return null
  let s = 0
  for (const p of pos) for (const q of neg) s += p > q ? 1 : p === q ? 0.5 : 0
  return s / (pos.length * neg.length)
}
// a "session" = one item on one day. Only sessions where the item sometimes worked and sometimes did not can teach anything.
const sessionKey = r => `${r.item}|${r.day}`
const sessions = [...new Set(rows.map(sessionKey))].map(k => {
  const g = rows.filter(r => sessionKey(r) === k)
  return { key: k, n: g.length, ok: g.filter(r => r.ok).length }
})
const itemsWithContrast = sessions.filter(s => s.ok >= 5 && s.n - s.ok >= 5).map(s => s.key)
const sessionsWithoutContrast = sessions.filter(s => s.n >= 8 && (s.ok === 0 || s.ok === s.n))

// ── 2. does each feature say anything beyond the item? ──────────────────────────
const report = { file: path.relative(ROOT, file), orders: rows.length, delivered: rows.filter(r => r.ok).length, days: [...new Set(rows.map(r => r.day))].length, itemsCompared: itemsWithContrast, features: {} }
for (const [k, def] of Object.entries(FEATURES)) {
  let wSum = 0, n = 0
  const perItem = []
  for (const it of itemsWithContrast) {
    const g = rows.filter(r => sessionKey(r) === it && r.f[k] != null)
    const pos = g.filter(r => r.ok).map(r => r.f[k]), neg = g.filter(r => !r.ok).map(r => r.f[k])
    if (pos.length < 4 || neg.length < 4) continue
    const a = auc(pos, neg)
    perItem.push({ item: it, auc: +a.toFixed(2), delivered: pos.length, other: neg.length })
    // direction-free: how far from a coin toss
    wSum += Math.abs(a - 0.5) * (pos.length + neg.length); n += pos.length + neg.length
  }
  const strength = n ? 0.5 + wSum / n : null
  report.features[k] = { label: def.label, withinItemStrength: strength == null ? null : +strength.toFixed(2), coverage: rows.filter(r => r.f[k] != null).length, perItem }
}

// ── 3. statements for a failed order ────────────────────────────────────────────
function statementsFor(row) {
  const out = []
  const sameItem = rows.filter(r => sessionKey(r) === sessionKey(row) && r.id !== row.id)
  for (const [k, def] of Object.entries(FEATURES)) {
    const strength = report.features[k].withinItemStrength
    const v = row.f[k]
    if (v == null || strength == null || strength < 0.62) continue          // only features that mean something
    const pool = sameItem.filter(r => r.f[k] != null)
    // "better" side: cut at the median of this item's delivered orders
    const good = pool.filter(r => r.ok).map(r => r.f[k]).sort((a, b) => a - b)
    if (good.length < 4) continue
    const med = good[Math.floor(good.length / 2)]
    const higherIsBetter = (auc(good, pool.filter(r => !r.ok).map(r => r.f[k])) ?? 0.5) >= 0.5
    const isWorse = higherIsBetter ? v < med : v > med
    if (!isWorse) continue
    const better = pool.filter(r => (higherIsBetter ? r.f[k] >= med : r.f[k] <= med))
    const alike = pool.filter(r => !(higherIsBetter ? r.f[k] >= med : r.f[k] <= med))
    if (better.length < MIN_GROUP || alike.length < MIN_GROUP) continue
    const kb = better.filter(r => r.ok).length, ka = alike.filter(r => r.ok).length
    const pb = kb / better.length, pa = ka / alike.length
    const [lb] = wilson(kb, better.length), [, ua] = wilson(ka, alike.length)
    if (pb - pa < MIN_GAP || lb <= ua) continue                             // not clearly different
    out.push({
      feature: k, label: def.label, value: v, cutoff: +med.toFixed(2), direction: higherIsBetter ? 'at least' : 'at most',
      better: { delivered: kb, of: better.length }, alike: { delivered: ka, of: alike.length },
      text: `This ${row.item} order had a ${def.label} of ${+(+v).toFixed(2)}. Other ${row.item} orders with ${higherIsBetter ? 'a value of at least' : 'a value of at most'} ${+med.toFixed(2)} were delivered ${kb} of ${better.length} times; the ones like this one ${ka} of ${alike.length}.`,
      gap: +(pb - pa).toFixed(2),
    })
  }
  return out.sort((a, b) => b.gap - a.gap).slice(0, 3)
}

const failed = rows.filter(r => !r.ok && (onlyOrder == null || r.id === onlyOrder))
const results = failed.map(r => ({ id: r.id, item: r.item, status: r.status, reason: r.reason, statements: statementsFor(r) }))
report.sessionsWithoutContrast = sessionsWithoutContrast.map(s => `${s.key.replace('|', ' on ')}: ${s.ok} of ${s.n} delivered`)
report.failedOrders = failed.length
report.withAStatement = results.filter(r => r.statements.length).length

// ── does a statement hold up on orders it has not seen? ─────────────────────────
// Leave one order out; predict "delivered" from its item's rate and from the one best feature; compare.
function holdOut() {
  const res = { orders: 0, sessionRate: 0 }
  const right = { sessionRate: 0 }
  const feats = ['match_score', 'depth_m', 'grip_mm']
  for (const f of feats) { res[f] = 0; right[f] = 0 }
  for (const r of rows) {
    const g = rows.filter(x => sessionKey(x) === sessionKey(r) && x.id !== r.id)
    if (g.length < 15) continue
    res.orders++
    const base = g.filter(x => x.ok).length / g.length >= 0.5
    if (base === r.ok) right.sessionRate++
    for (const f of feats) {
      const withF = g.filter(x => x.f[f] != null)
      let guess = base
      if (r.f[f] != null && withF.length >= 15) {
        const near = [...withF].sort((x, y) => Math.abs(x.f[f] - r.f[f]) - Math.abs(y.f[f] - r.f[f])).slice(0, 7)
        guess = near.filter(x => x.ok).length / near.length >= 0.5
      }
      if (guess === r.ok) right[f]++
    }
  }
  const out = { orders: res.orders }
  for (const k of Object.keys(right)) out[k] = +(right[k] / res.orders).toFixed(3)
  return out
}
report.holdOut = holdOut()

if (asJson) { console.log(JSON.stringify({ report, results }, null, 1)); process.exit(0) }

console.log(`\n${report.file}: ${report.orders} orders on ${report.days} days, ${report.delivered} delivered cleanly\n`)
console.log(`Sessions (an item on one day) with both outcomes: ${itemsWithContrast.length}; sessions where every order went the same way: ${sessionsWithoutContrast.length}`)
for (const s of report.sessionsWithoutContrast) console.log(`   no contrast: ${s}`)
console.log('\nDoes a factor say anything beyond the item and the day? (0.50 = coin toss)')
for (const [k, f] of Object.entries(report.features)) {
  const s = f.withinItemStrength
  console.log(`  ${f.label.padEnd(34)} ${s == null ? '  n/a' : s.toFixed(2)}  ${s == null ? '' : s >= 0.62 ? 'usable' : s >= 0.56 ? 'weak' : 'no signal'}   (${f.coverage} orders have it)`)
}
console.log(`\nPredicting unseen orders (leave one out, within the same item and day, ${report.holdOut.orders} orders): the session's own rate ${pct(report.holdOut.sessionRate)} right; adding the match score ${pct(report.holdOut.match_score)}, the depth ${pct(report.holdOut.depth_m)}, the grip width ${pct(report.holdOut.grip_mm)}`)
console.log(`\nFailed or warned orders: ${report.failedOrders}; with at least one honest statement: ${report.withAStatement}\n`)
for (const r of results.filter(r => r.statements.length).slice(0, onlyOrder ? 1 : 6)) {
  console.log(`#${r.id} ${r.item} (${r.status}${r.reason ? ', ' + r.reason : ''})`)
  for (const s of r.statements) console.log(`   - ${s.text}`)
}
const none = results.filter(r => !r.statements.length)
console.log(`\n${none.length} orders get no statement (too few similar orders, or no factor stands out). Examples: ${none.slice(0, 8).map(r => `#${r.id} ${r.item}`).join(', ')}`)
