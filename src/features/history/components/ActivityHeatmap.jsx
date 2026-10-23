import React, { useState, useEffect, useMemo } from 'react'
import Card from '../../../components/ui/Card'
import { getApiBase } from '../../../lib/urls'
import { buildHeatmap, readout } from '../../../lib/heatmap'
import { useRobot } from '../../../robots/RobotContext'

const EMERALD_700 = '#047857'
const ROSE_700 = '#be123c'
const AMBER_700 = '#854d0e'
const GRAY_200 = '#e5e7eb'
const GRAY_400 = '#9ca3af'


function todayStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const METRICS = [
  { id: 'orders', label: 'Orders' },
  { id: 'rate', label: 'Failure rate' },
]

function Cell({ c, height, selected, onPick, onPeek }) {
  if (c.blank) return <div style={{ height }} />
  return (
    <button
      type="button"
      aria-label={c.aria}
      aria-pressed={selected}
      onClick={onPick}
      onMouseEnter={onPeek}
      onFocus={onPeek}
      className="relative flex items-center justify-center p-0 border-0 rounded-[4px] cursor-pointer font-semibold text-[14px] hover:brightness-95"
      style={{ height, background: c.bg, color: c.fg, boxShadow: selected ? '0 0 0 2px var(--text-primary)' : 'none' }}
    >
      {c.sub && <span className="absolute top-[3px] left-[5px] text-[10px] font-medium opacity-80">{c.sub}</span>}
      {c.text}
    </button>
  )
}

function Readout({ tag, r }) {
  return (
    <div className="w-full lg:w-[296px] shrink-0 p-4 rounded-xl bg-[var(--bg)] self-start">
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">{tag}</div>
      <div className="mt-1 text-[14px] font-semibold">{r.title}</div>
      <div className="mt-3 text-[32px] font-bold leading-[1.1] tabular-nums">{r.big}</div>
      <div className="mt-0.5 text-[13px] text-[var(--text-secondary)]">{r.sub}</div>
      <div className="flex gap-0.5 h-2 mt-3.5">
        {r.bar.map((b, i) => <span key={i} className="rounded" style={{ flexGrow: b.n, flexBasis: 0, background: b.bg }} />)}
      </div>
      <div className="flex flex-col gap-1.5 mt-3">
        {r.rows.map(x => (
          <div key={x.label} className="flex items-center gap-2 text-[13px]">
            <span className="w-2 h-2 rounded-full" style={{ background: x.color }} />
            <span className="flex-1">{x.label}</span>
            <span className="font-semibold tabular-nums">{x.count}</span>
          </div>
        ))}
      </div>
      {r.note && <div className="mt-3 text-[12px] leading-normal text-[var(--text-secondary)]">{r.note}</div>}
    </div>
  )
}

export default function ActivityHeatmap({ dateFrom, dateTo }) {
  const from = dateFrom || todayStr()
  const to = dateTo || todayStr()

  const [totals, setTotals] = useState(null)
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [metric, setMetric] = useState('orders')
  const [sel, setSel] = useState(null)
  const [hov, setHov] = useState(null)
  const { robotId, profile } = useRobot()
  const labels = profile.labels

  // another robot, another orders file: forget the previous one's numbers
  useEffect(() => { setRows(null); setTotals(null) }, [robotId])

  // Order data comes from the relay server — independent of the AI server
  useEffect(() => {
    let live = true
    setLoading(true)
    const base = getApiBase(robotId)
    Promise.all([
      fetch(`${base}/api/orders/daily?from=${from}&to=${to}`).then(r => (r.ok ? r.json() : null)),
      fetch(`${base}/api/orders/times?from=${from}&to=${to}`).then(r => (r.ok ? r.json() : null)),
    ])
      .then(([daily, times]) => {
        if (!live) return
        if (daily) setTotals(daily.totals)
        if (times) setRows(times.orders)
      })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [from, to, robotId])

  // A new range or metric starts from the default selection
  useEffect(() => { setSel(null); setHov(null) }, [from, to, metric])

  const model = useMemo(() => (rows ? buildHeatmap({ rows, from, to, metric, labels }) : null), [rows, from, to, metric, labels])

  if (loading && !model) {
    return (
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">{[1, 2, 3].map(i => <div key={i} className="skeleton flex-1 h-16 rounded-lg" />)}</div>
          <div className="skeleton h-48 rounded-lg" />
        </div>
      </Card>
    )
  }

  const t = totals || { delivered: 0, warning: 0, failed: 0, avg_fetch_seconds: 0 }
  const effMetric = model && model.showMetric ? metric : 'orders'
  const active = model && ((hov && model.info[hov]) ? hov : ((sel && model.info[sel]) ? sel : model.bestKey))
  const tag = hov && model?.info[hov] ? 'Hover' : sel && model?.info[sel] ? 'Selected' : model?.bestTag
  const r = model && active ? readout(model, active, effMetric, labels) : null

  return (
    <Card>
      <div className="flex items-end justify-between gap-4 mb-3 flex-wrap">
        <div>
          <h2 className="text-[clamp(18px,2.4vw,21px)] font-semibold text-[var(--text-primary)] m-0">Activity</h2>
          <div className="text-[12px] text-[var(--text-secondary)]">{model?.note}</div>
        </div>
        {model?.showMetric && (
          <div role="group" aria-label="Metric" className="flex gap-0.5 p-0.5 rounded-full bg-[#f3f4f6]">
            {METRICS.map(m => (
              <button
                key={m.id}
                type="button"
                aria-pressed={metric === m.id}
                onClick={() => setMetric(m.id)}
                className="h-7 px-3 rounded-full text-[13px] font-semibold border-0 cursor-pointer"
                style={{
                  background: metric === m.id ? '#ffffff' : 'transparent',
                  color: metric === m.id ? 'var(--text-primary)' : '#4b5563',
                  boxShadow: metric === m.id ? '0 1px 2px rgba(15, 23, 42, 0.12)' : 'none',
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tally stats (daisyUI) — colour coding kept on the values */}
      <div className="stats stats-horizontal w-full mb-5 shadow-none border border-solid" style={{ borderColor: GRAY_200 }}>
        <div className="stat">
          <div className="stat-title">{labels.delivered}</div>
          <div className="stat-value text-[clamp(22px,3vw,30px)]" style={{ color: EMERALD_700 }}>{t.delivered}</div>
        </div>
        <div className="stat" style={{ opacity: t.warning === 0 ? 0.5 : 1 }}>
          <div className="stat-title">{labels.warning}</div>
          <div className="stat-value text-[clamp(22px,3vw,30px)]" style={{ color: AMBER_700 }}>{t.warning}</div>
        </div>
        <div className="stat" style={{ opacity: t.failed === 0 ? 0.5 : 1 }}>
          <div className="stat-title">{labels.failed}</div>
          <div className="stat-value text-[clamp(22px,3vw,30px)]" style={{ color: ROSE_700 }}>{t.failed}</div>
        </div>
        <div className="stat">
          <div className="stat-title">{profile.avgTimeLabel}</div>
          <div className="stat-value text-[clamp(22px,3vw,30px)] text-[var(--text-primary)]">
            {t.avg_fetch_seconds}<span className="text-[14px] font-normal ml-1" style={{ color: GRAY_400 }}>s</span>
          </div>
        </div>
      </div>

      {model && (
        <div className="flex flex-wrap lg:flex-nowrap gap-6 items-start">
          <div className="grow min-w-0 w-full" onMouseLeave={() => setHov(null)}>
            {model.empty && (
              <div className="mb-3 text-[13px] text-[var(--text-secondary)]">No orders in this range yet.</div>
            )}
            <div className="grid gap-0.5 items-end mb-1" style={{ gridTemplateColumns: model.gridCols }}>
              {model.heads.map((h, i) => (
                <span key={i} className="text-[11px] font-semibold text-[var(--text-secondary)] px-0.5 pb-0.5" style={{ textAlign: h.align }}>{h.text}</span>
              ))}
            </div>
            <div className="flex flex-col gap-0.5">
              {model.rows.map(row => (
                <div key={row.label} className="grid gap-0.5 items-stretch" style={{ gridTemplateColumns: model.gridCols }}>
                  <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-primary)] min-w-0">
                    {row.dot !== 'transparent' && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: row.dot }} />}
                    {row.label}
                  </span>
                  {row.cells.map((c, i) => (
                    <Cell
                      key={c.key || `blank-${i}`}
                      c={c}
                      height={model.cellH}
                      selected={!!c.key && c.key === active}
                      onPick={() => setSel(s => (s === c.key ? null : c.key))}
                      onPeek={() => setHov(c.key)}
                    />
                  ))}
                  <span className="flex items-center justify-end text-[12px] text-[var(--text-secondary)] pr-0.5 tabular-nums">{row.total}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4">
              {model.legend.map(lg => (
                <div key={lg.title} className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[12px] font-semibold text-[var(--text-secondary)]">{lg.title}</span>
                  {lg.items.map(it => (
                    <span key={it.text} className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                      <span className="w-3.5 h-3.5 rounded-[3px]" style={{ background: it.bg }} />
                      {it.text}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {r && <Readout tag={tag} r={r} />}
        </div>
      )}
    </Card>
  )
}
