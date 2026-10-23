import React from 'react'
import Card from '../../../components/ui/Card'
import { useDataSource } from '../../../context/DataSourceContext'
import { formatDuration, formatSeconds } from './AttentionPanel'
import { useRobot } from '../../../robots/RobotContext'

// dot colour per status; the wording comes from the robot's profile
const DOT = { success: 'var(--success)', ok: 'var(--success)', warning: 'var(--warning)', failed: 'var(--danger)' }

function outcomeText(profile, o) {
  const reason = profile.reasons[o.failure?.reason]
  if (o.status === 'success' || o.status === 'ok') return profile.labels.delivered
  if (o.status === 'warning') return profile.id === 'bar' ? (reason || profile.labels.warningOutcome) : profile.labels.warningOutcome
  return reason || profile.labels.failed
}

function Stat({ value, label }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[clamp(18px,2.4vw,22px)] font-extrabold tabular-nums text-[var(--text-primary)]">{value}</span>
      <span className="text-[12px] text-[var(--text-secondary)]">{label}</span>
    </div>
  )
}

function RecentOrder({ o }) {
  const { profile } = useRobot()
  const dot = DOT[o.status] || DOT.failed
  const ago = o.completed_at ? formatDuration(Date.now() - new Date(o.completed_at).getTime()) : ''
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg bg-[var(--bg)] text-[13px]">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dot }} />
        <span className="font-medium whitespace-nowrap">{o.item ? o.item.charAt(0).toUpperCase() + o.item.slice(1) : 'Order'}</span>
        <span className="text-[12px] text-[var(--text-secondary)]">#{o.order_number || o.id}</span>
        <span className="text-[12px] text-[var(--text-secondary)] truncate">{outcomeText(profile, o)}</span>
      </div>
      <span className="text-[12px] text-[var(--text-secondary)] whitespace-nowrap tabular-nums">
        {ago ? `${ago} ago · ` : ''}{formatSeconds(o.total_seconds)}
      </span>
    </div>
  )
}

/** Today so far — one strip: the day's numbers, the outcome mix, the last two orders. */
function TodayStrip({ style }) {
  const { recentOrders } = useDataSource()
  const { profile } = useRobot()
  const t = recentOrders?.today
  if (!t) {
    return (
      <Card style={style}>
        <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Today so far</div>
        <div className="text-[13px] text-[var(--text-secondary)] mt-1">Waiting for the first order…</div>
      </Card>
    )
  }

  const parts = [
    { n: t.delivered, color: 'var(--success)' },
    { n: t.warning, color: 'var(--warning)' },
    { n: t.failed, color: 'var(--danger)' },
  ].filter(p => p.n > 0)

  return (
    <Card style={style}>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="shrink-0">
          <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Today so far</div>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 mt-1">
            <Stat value={t.total} label={t.total === 1 ? profile.nouns.order : profile.nouns.orders} />
            <Stat value={formatSeconds(t.avg_seconds)} label="avg time" />
            <Stat value={profile.needHelp(t)} label="needed help" />
          </div>
        </div>

        <div className="flex-1 min-w-[200px]">
          <div
            className="flex gap-0.5 h-2"
            role="img"
            aria-label={`Today: ${t.delivered} delivered, ${t.warning} with warnings, ${t.failed} couldn't deliver`}
          >
            {parts.length === 0
              ? <span className="flex-1 rounded bg-[var(--border)]" />
              : parts.map((p, i) => <span key={i} className="rounded" style={{ flexGrow: p.n, flexBasis: 0, background: p.color }} />)}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[11px] text-[var(--text-secondary)]">
            <span><span className="inline-block w-2 h-2 rounded-full mr-1 bg-[var(--success)]" />{profile.labels.delivered} {t.delivered}</span>
            <span><span className="inline-block w-2 h-2 rounded-full mr-1 bg-[var(--warning)]" />{profile.labels.warning} {t.warning}</span>
            <span><span className="inline-block w-2 h-2 rounded-full mr-1 bg-[var(--danger)]" />{profile.labels.failed} {t.failed}</span>
          </div>
        </div>

        {t.recent?.length > 0 && (
          <div className="flex flex-col gap-1 w-full lg:w-[360px] shrink-0">
            {t.recent.map(o => <RecentOrder key={o.id} o={o} />)}
          </div>
        )}
      </div>
    </Card>
  )
}

export default function RobotStatusCard({ params, suggestion, style }) {
  const { mode } = useDataSource()

  if (mode === 'mock') {
    if (!params?.length) return null
    return <OldParamsCard params={params} suggestion={suggestion} style={style} />
  }
  return <TodayStrip style={style} />
}

function OldParamsCard({ params, suggestion, style }) {
  const STATUS_CLS = {
    ok:      { dot: 'bg-[var(--success)]', text: 'text-[var(--success)]', bg: 'bg-[var(--success-bg)]' },
    warning: { dot: 'bg-[var(--danger)]',  text: 'text-[var(--danger)]',  bg: 'bg-[var(--danger-bg)]'  },
  }

  return (
    <Card style={style}>
      <h2 className="text-[clamp(20px,2.4vw,24px)] font-bold text-[var(--text-primary)] mb-3">Parameters</h2>
      <div className="flex flex-col gap-2.5">
        {params.map(p => {
          const s = STATUS_CLS[p.status] || STATUS_CLS.ok
          return (
            <div key={p.key} className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] ${s.bg}`}>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-[var(--text-tertiary)] uppercase">{p.label}</div>
                <div className={`text-[14px] font-medium ${s.text}`}>{p.value}</div>
              </div>
              <div className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
            </div>
          )
        })}
      </div>
      {suggestion && (
        <div className="mt-3 px-3 py-2.5 rounded-[10px] bg-[var(--bg)] border-l-[3px] border-solid border-[var(--primary)]">
          <p className="text-[13px] text-[var(--text-secondary)] m-0">{suggestion}</p>
        </div>
      )}
    </Card>
  )
}
