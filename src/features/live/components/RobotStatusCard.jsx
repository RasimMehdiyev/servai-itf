import React from 'react'
import Card from '../../../components/ui/Card'
import { useDataSource } from '../../../context/DataSourceContext'
import { formatDuration, formatSeconds } from './AttentionPanel'

function RecentlyDelivered({ list }) {
  if (!list || list.length === 0) return null

  return (
    <div className="mt-4">
      <div className="h-px bg-[var(--border)] mb-3" />
      <div className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">Recently delivered</div>
      <div className="flex flex-col gap-1.5">
        {list.slice(0, 4).map((o, i) => {
          const ago = formatDuration(Date.now() - new Date(o.completed_at).getTime())
          return (
            <div key={o.id || i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg)]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
                <span className="font-medium text-[clamp(13px,1.5vw,14px)]">
                  {o.item?.charAt(0).toUpperCase() + o.item?.slice(1)}
                </span>
                <span className="text-[12px] text-[var(--text-tertiary)]">#{o.id}</span>
              </div>
              <div className="flex items-center gap-3 text-[12px] text-[var(--text-tertiary)]">
                <span>{ago} ago</span>
                <span>{formatSeconds(o.total_seconds)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function RobotStatusCard({ params, suggestion, style }) {
  const { liveData, recentOrders, mode } = useDataSource()
  const recentList = recentOrders?.recent || []
  const { total: totalOrders = 0, failedCount: helpCount = 0 } = recentOrders || {}
  const avgTime = recentList.length > 0
    ? Math.round(recentList.reduce((s, o) => s + (o.total_seconds || 0), 0) / recentList.length)
    : 0

  if (mode === 'mock') {
    if (!params?.length) return null
    return <OldParamsCard params={params} suggestion={suggestion} style={style} />
  }

  return (
    <Card style={style}>
      <div className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-1">Session overview</div>
      <h2 className="text-[clamp(18px,2.2vw,22px)] font-bold text-[var(--text-primary)] m-0 mb-4">Today so far</h2>

      <div className="grid grid-cols-3 gap-3">
        <div className="text-center px-2 py-3 rounded-lg bg-[var(--bg)]">
          <div className="text-[clamp(20px,2.5vw,26px)] font-bold text-[var(--text-primary)] tabular-nums">{totalOrders}</div>
          <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5">orders</div>
        </div>
        <div className="text-center px-2 py-3 rounded-lg bg-[var(--bg)]">
          <div className="text-[clamp(20px,2.5vw,26px)] font-bold text-[var(--text-primary)] tabular-nums">{formatSeconds(avgTime)}</div>
          <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5">avg time</div>
        </div>
        <div className="text-center px-2 py-3 rounded-lg bg-[var(--bg)]">
          <div className="text-[clamp(20px,2.5vw,26px)] font-bold text-[var(--text-primary)] tabular-nums">{helpCount}</div>
          <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5">needed help</div>
        </div>
      </div>

      <RecentlyDelivered list={recentList} />
    </Card>
  )
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
