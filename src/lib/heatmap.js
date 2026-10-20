/**
 * Activity heatmap model: buckets orders by time and paints the cells.
 *
 * Pure functions (no React) so the bucketing can be checked against the real
 * order history. Cell colours follow the dataviz rules used on the design canvas:
 * one hue per metric (blue for volume, rose for failure rate), at most five
 * bins, text colour chosen for contrast, and rates under 3 orders greyed out.
 */

export const RAMPS = {
  blue: [
    { bg: '#e3eeff', fg: '#0f172a' }, { bg: '#b3d0ff', fg: '#0f172a' }, { bg: '#7fb0ff', fg: '#0f172a' },
    { bg: '#2b7fff', fg: '#0f172a' }, { bg: '#1b4fb8', fg: '#ffffff' },
  ],
  rose: [
    { bg: '#ffe4e6', fg: '#0f172a' }, { bg: '#fda4af', fg: '#0f172a' }, { bg: '#fb7185', fg: '#0f172a' },
    { bg: '#e11d48', fg: '#ffffff' }, { bg: '#9f1239', fg: '#ffffff' },
  ],
  green: [
    { bg: '#d1fae5', fg: '#0f172a' }, { bg: '#6ee7b7', fg: '#0f172a' }, { bg: '#10b981', fg: '#0f172a' }, { bg: '#047857', fg: '#ffffff' },
  ],
  amber: [
    { bg: '#fef3c7', fg: '#0f172a' }, { bg: '#fcd34d', fg: '#0f172a' }, { bg: '#f59e0b', fg: '#0f172a' }, { bg: '#b45309', fg: '#ffffff' },
  ],
  rose4: [
    { bg: '#ffe4e6', fg: '#0f172a' }, { bg: '#fda4af', fg: '#0f172a' }, { bg: '#f43f5e', fg: '#0f172a' }, { bg: '#be123c', fg: '#ffffff' },
  ],
}

export const NEUTRAL = '#f3f4f6'
export const MIN_RATE_ORDERS = 3

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const p2 = (n) => String(n).padStart(2, '0')

export function ymd(d) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}
export function parseDay(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0)
}
function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
export function daysBetween(from, to) {
  return Math.round((parseDay(to) - parseDay(from)) / 86400000) + 1
}

// 0 delivered, 1 with warnings, 2 couldn't deliver
function outcome(s) {
  if (s === 'warning') return 1
  if (s === 'success' || s === 'ok') return 0
  return 2
}

const pct = (f, n) => Math.round((100 * f) / n)

function pickRamp(ramp, b, nb) {
  return ramp[nb <= 1 ? ramp.length - 1 : Math.round((b * (ramp.length - 1)) / (nb - 1))]
}
function binOrders(n, max) {
  const nb = Math.min(5, max)
  return { b: Math.min(nb - 1, Math.floor(((n - 1) * nb) / max)), nb }
}
function binRate(r) {
  return r < 0.10 ? 0 : r < 0.20 ? 1 : r < 0.30 ? 2 : r < 0.45 ? 3 : 4
}

function ordersLegend(max) {
  const nb = Math.min(5, max)
  const items = [{ bg: NEUTRAL, text: '0' }]
  for (let b = 0; b < nb; b++) {
    const lo = Math.floor((b * max) / nb) + 1
    const hi = Math.floor(((b + 1) * max) / nb)
    items.push({ bg: pickRamp(RAMPS.blue, b, nb).bg, text: lo === hi ? String(lo) : `${lo}–${hi}` })
  }
  return { title: 'Orders per cell', items }
}
function rateLegend() {
  return {
    title: 'Failure rate',
    items: [{ bg: NEUTRAL, text: `under ${MIN_RATE_ORDERS} orders` }].concat(
      ['<10%', '10–19%', '20–29%', '30–44%', '45%+'].map((t, i) => ({ bg: RAMPS.rose[i].bg, text: t })),
    ),
  }
}

function paint(metric, d, w, f, max) {
  const n = d + w + f
  if (metric === 'orders') {
    if (n === 0) return { bg: NEUTRAL, fg: '#9ca3af', text: '' }
    const q = binOrders(n, max)
    const c = pickRamp(RAMPS.blue, q.b, q.nb)
    return { bg: c.bg, fg: c.fg, text: String(n) }
  }
  if (n < MIN_RATE_ORDERS) return { bg: NEUTRAL, fg: '#6b7280', text: n === 0 ? '' : '·' }
  const c = RAMPS.rose[binRate(f / n)]
  return { bg: c.bg, fg: c.fg, text: `${pct(f, n)}%` }
}

function aria(title, d, w, f) {
  const n = d + w + f
  return `${title}: ${n} ${n === 1 ? 'order' : 'orders'}, ${d} delivered, ${w} with warnings, ${f} failed`
}

/**
 * @param {{ rows: {t:string,s:string}[], from:string, to:string, metric?: 'orders'|'rate' }} args
 *   rows: orders with start time `t` (ISO) and status `s`; from/to: local YYYY-MM-DD, inclusive
 */
export function buildHeatmap({ rows, from, to, metric = 'orders' }) {
  const nDays = Math.max(1, daysBetween(from, to))
  const inRange = []
  for (const r of rows || []) {
    const dt = new Date(r.t)
    if (Number.isNaN(dt.getTime())) continue
    const day = ymd(dt)
    if (day < from || day > to) continue
    inRange.push({ day, hour: dt.getHours(), o: outcome(r.s) })
  }

  const info = {}
  const set = (key, title, d, w, f) => { info[key] = { title, d, w, f, n: d + w + f } }
  let best = { key: null, score: -1 }
  const consider = (key, score) => { if (score > best.score) best = { key, score } }

  const minH = inRange.length ? Math.min(...inRange.map(r => r.hour)) : 9
  const maxH = inRange.length ? Math.max(...inRange.map(r => r.hour)) : 17

  // ── One day: hours across, outcomes down ────────────────────────────────────
  if (nDays === 1) {
    const start = Math.max(0, Math.min(9, minH))
    const end = Math.min(23, Math.max(17, maxH))
    const hours = []
    for (let h = start; h <= end; h++) hours.push(h)
    const counts = hours.map(h => [0, 0, 0])
    for (const r of inRange) counts[r.hour - start][r.o]++
    hours.forEach((h, i) => set(`h:${h}`, `${p2(h)}:00–${p2(h + 1)}:00`, counts[i][0], counts[i][1], counts[i][2]))
    const defs = [
      ['Delivered', '#10b981', 0, RAMPS.green],
      ['With warnings', '#ca8a04', 1, RAMPS.amber],
      ['Couldn’t deliver', '#f43f5e', 2, RAMPS.rose4],
    ]
    const outRows = defs.map(([label, dot, idx, ramp]) => {
      let tot = 0
      const cells = hours.map((h, i) => {
        const n = counts[i][idx]
        tot += n
        const col = n === 0 ? { bg: NEUTRAL, fg: '#9ca3af' } : ramp[Math.min(ramp.length - 1, n - 1)]
        const inf = info[`h:${h}`]
        return { key: `h:${h}`, bg: col.bg, fg: col.fg, text: n === 0 ? '' : String(n), sub: '', aria: aria(inf.title, inf.d, inf.w, inf.f) }
      })
      return { label, dot, cells, total: String(tot) }
    })
    hours.forEach((h, i) => consider(`h:${h}`, counts[i][2] * 100 + counts[i][0] + counts[i][1]))
    return {
      kind: 'hours',
      gridCols: `112px repeat(${hours.length}, minmax(0, 1fr)) 52px`,
      cellH: 44,
      note: `${WD[parseDay(from).getDay()]} ${MON[parseDay(from).getMonth()]} ${parseDay(from).getDate()} · orders per hour`,
      heads: [{ text: 'Outcome', align: 'left' }, ...hours.map(h => ({ text: p2(h), align: 'center' })), { text: 'Total', align: 'right' }],
      rows: outRows,
      legend: defs.map(([label, , , ramp]) => ({ title: label, items: [1, 2, 3, 4].map(k => ({ bg: ramp[k - 1].bg, text: k === 4 ? '4+' : String(k) })) })),
      info, bestKey: best.key, bestTag: 'Most failures', showMetric: false, empty: inRange.length === 0,
    }
  }

  // ── Up to a week: days down, two-hour blocks across ─────────────────────────
  if (nDays <= 8) {
    const start = Math.floor(Math.max(0, Math.min(9, minH)) / 2) * 2
    const end = Math.min(24, Math.ceil(Math.max(18, maxH + 1) / 2) * 2)
    const blocks = []
    for (let h = start; h < end; h += 2) blocks.push(h)
    const days = []
    for (let i = 0; i < nDays; i++) days.push(ymd(addDays(parseDay(from), i)))
    const grid = new Map(days.map(d => [d, blocks.map(() => [0, 0, 0])]))
    for (const r of inRange) {
      const bi = Math.min(blocks.length - 1, Math.max(0, Math.floor((r.hour - start) / 2)))
      grid.get(r.day)[bi][r.o]++
    }
    let max = 1
    grid.forEach(arr => arr.forEach(([d, w, f]) => { max = Math.max(max, d + w + f) }))
    const outRows = days.map(day => {
      const dt = parseDay(day)
      let T = [0, 0, 0]
      const cells = grid.get(day).map(([d, w, f], bi) => {
        const key = `b:${day}:${blocks[bi]}`
        const title = `${WD[dt.getDay()]} ${MON[dt.getMonth()]} ${dt.getDate()} · ${p2(blocks[bi])}:00–${p2(blocks[bi] + 2)}:00`
        set(key, title, d, w, f)
        T = [T[0] + d, T[1] + w, T[2] + f]
        const n = d + w + f
        if (metric === 'orders') consider(key, n)
        else if (n >= 5) consider(key, (f / n) * 1000 + n)
        const p = paint(metric, d, w, f, max)
        return { key, bg: p.bg, fg: p.fg, text: p.text, sub: '', aria: aria(title, d, w, f) }
      })
      const tn = T[0] + T[1] + T[2]
      return { label: `${WD[dt.getDay()]} ${dt.getDate()}`, dot: 'transparent', cells, total: metric === 'rate' ? (tn ? `${pct(T[2], tn)}%` : '–') : String(tn) }
    })
    return {
      kind: 'blocks',
      gridCols: `64px repeat(${blocks.length}, minmax(0, 1fr)) 52px`,
      cellH: 40,
      note: `${MON[parseDay(from).getMonth()]} ${parseDay(from).getDate()} – ${MON[parseDay(to).getMonth()]} ${parseDay(to).getDate()} · orders started per 2-hour block`,
      heads: [{ text: 'Day', align: 'left' }, ...blocks.map(h => ({ text: `${p2(h)}–${p2(h + 2)}`, align: 'center' })), { text: metric === 'rate' ? 'Rate' : 'Total', align: 'right' }],
      rows: outRows,
      legend: [metric === 'rate' ? rateLegend() : ordersLegend(max)],
      info, bestKey: best.key, bestTag: metric === 'rate' ? 'Highest failure rate' : 'Busiest cell', showMetric: true, empty: inRange.length === 0,
    }
  }

  // ── Longer: a calendar, weeks down, weekdays across ─────────────────────────
  const first = parseDay(from)
  const offset = (first.getDay() + 6) % 7           // Monday-first
  const perDay = new Map()
  for (const r of inRange) {
    if (!perDay.has(r.day)) perDay.set(r.day, [0, 0, 0])
    perDay.get(r.day)[r.o]++
  }
  let max = 1
  perDay.forEach(([d, w, f]) => { max = Math.max(max, d + w + f) })
  const nWeeks = Math.ceil((offset + nDays) / 7)
  const outRows = []
  for (let wk = 0; wk < nWeeks; wk++) {
    const monday = addDays(first, wk * 7 - offset)
    let T = [0, 0, 0]
    const cells = []
    for (let k = 0; k < 7; k++) {
      const di = wk * 7 + k - offset
      if (di < 0 || di >= nDays) { cells.push({ blank: true }); continue }
      const dt = addDays(first, di)
      const day = ymd(dt)
      const [d, w, f] = perDay.get(day) || [0, 0, 0]
      const key = `d:${day}`
      const title = `${WD[dt.getDay()]} ${MON[dt.getMonth()]} ${dt.getDate()}`
      set(key, title, d, w, f)
      T = [T[0] + d, T[1] + w, T[2] + f]
      const n = d + w + f
      if (metric === 'orders') consider(key, n)
      else if (n >= MIN_RATE_ORDERS) consider(key, (f / n) * 1000 + n)
      const p = paint(metric, d, w, f, max)
      cells.push({ key, bg: p.bg, fg: p.fg, text: p.text, sub: String(dt.getDate()), aria: aria(title, d, w, f) })
    }
    const tn = T[0] + T[1] + T[2]
    outRows.push({ label: `${MON[monday.getMonth()]} ${monday.getDate()}`, dot: 'transparent', cells, total: metric === 'rate' ? (tn ? `${pct(T[2], tn)}%` : '–') : String(tn) })
  }
  return {
    kind: 'calendar',
    gridCols: '72px repeat(7, minmax(0, 1fr)) 52px',
    cellH: 52,
    note: `${MON[first.getMonth()]} ${first.getDate()} – ${MON[parseDay(to).getMonth()]} ${parseDay(to).getDate()} · orders per day`,
    heads: [{ text: 'Week of', align: 'left' }, ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => ({ text: w, align: 'center' })), { text: metric === 'rate' ? 'Rate' : 'Total', align: 'right' }],
    rows: outRows,
    legend: [metric === 'rate' ? rateLegend() : ordersLegend(max)],
    info, bestKey: best.key, bestTag: metric === 'rate' ? 'Highest failure rate' : 'Busiest day', showMetric: true, empty: inRange.length === 0,
  }
}

/** Readout for one cell (hover/selected/best). */
export function readout(model, key, metric) {
  const a = model.info[key] || { title: '', d: 0, w: 0, f: 0, n: 0 }
  const n = a.n
  let big, sub, note = ''
  if (metric === 'rate' && model.kind !== 'hours') {
    big = n >= MIN_RATE_ORDERS ? `${pct(a.f, n)}% failed` : 'Too few orders'
    sub = `${a.f} of ${n} orders failed`
    if (n < MIN_RATE_ORDERS) note = `Only ${n} order${n === 1 ? '' : 's'} in this cell — too few for a reliable rate.`
  } else {
    big = `${n} ${n === 1 ? 'order' : 'orders'}`
    sub = n ? `${pct(a.f, n)}% failed` : 'No orders'
  }
  const bar = [
    { n: a.d, bg: '#10b981' }, { n: a.w, bg: '#ca8a04' }, { n: a.f, bg: '#f43f5e' },
  ].filter(x => x.n > 0)
  return {
    title: a.title,
    big,
    sub,
    note,
    bar: bar.length ? bar : [{ n: 1, bg: '#e5e7eb' }],
    rows: [
      { label: 'Delivered', color: '#10b981', count: a.d },
      { label: 'With warnings', color: '#ca8a04', count: a.w },
      { label: 'Couldn’t deliver', color: '#f43f5e', count: a.f },
    ],
  }
}
