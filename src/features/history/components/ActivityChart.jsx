import React, { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import Card from '../../../components/ui/Card'

const EMERALD_50 = '#ecfdf5'
const EMERALD_100 = '#d1fae5'
const EMERALD_500 = '#10b981'
const EMERALD_700 = '#047857'
const ROSE_50 = '#fff1f2'
const ROSE_100 = '#ffe4e6'
const ROSE_500 = '#f43f5e'
const ROSE_700 = '#be123c'
const AMBER_50 = '#fefce8'
const AMBER_100 = '#fef9c3'
const AMBER_500 = '#ca8a04'
const AMBER_700 = '#854d0e'
const GRAY_50 = '#f9fafb'
const GRAY_100 = '#f3f4f6'
const GRAY_200 = '#e5e7eb'
const GRAY_400 = '#9ca3af'
const GRAY_500 = '#6b7280'
const GRAY_900 = '#111827'
const TEAL_700 = '#0f766e'

import { getApiBase } from '../../../lib/urls'

// Order data comes from the WS server (always available)
const DATA_BASE = getApiBase()

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// Custom x-axis tick: weekday + date, with today emphasised (the TODAY marker).
function makeTick(chartData) {
  return function AxisTick({ x, y, payload }) {
    const d = chartData[payload.index]
    if (!d) return null
    const t = d.isToday
    return (
      <g transform={`translate(${x},${y})`}>
        {t && (
          <text x={0} y={8} textAnchor="middle" fontSize={9} fontWeight={700} fill={TEAL_700}
                style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Today
          </text>
        )}
        <text x={0} y={t ? 22 : 13} textAnchor="middle" fontSize={11}
              fontWeight={t ? 700 : 400} fill={t ? GRAY_900 : GRAY_500}>
          {d.weekday}
        </text>
        <text x={0} y={t ? 35 : 26} textAnchor="middle" fontSize={10} fill={GRAY_400}>
          {d.dateLabel}
        </text>
      </g>
    )
  }
}

// Custom tooltip — mirrors the old hand-rolled one.
function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const total = d.delivered + d.warning + d.failed
  if (total === 0) return null
  return (
    <div style={{
      background: GRAY_900, color: 'white', borderRadius: 8, padding: '6px 10px',
      fontSize: 11, whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    }}>
      {d.delivered} delivered
      {d.warning > 0 ? `, ${d.warning} with warnings` : ''}
      {d.failed > 0 ? `, ${d.failed} couldn't deliver` : ''}
    </div>
  )
}

export default function ActivityChart({ dateFrom, dateTo }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const from = dateFrom || todayStr()
  const to = dateTo || todayStr()

  // Fetch order data from the WS server — independent of AI
  useEffect(() => {
    setLoading(true)
    fetch(`${DATA_BASE}/api/orders/daily?from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [from, to])

  const totals = data?.totals || { delivered: 0, warning: 0, failed: 0, avg_fetch_seconds: 0 }

  const days = useMemo(() => {
    const raw = data?.days || []
    const firstActive = raw.findIndex(d => d.delivered + d.failed > 0)
    if (firstActive <= 0) return raw
    return raw.slice(Math.max(0, firstActive - 1))
  }, [data])

  const today = todayStr()

  const chartData = useMemo(() => days.map(d => {
    const dt = new Date(d.date + 'T12:00:00')
    return {
      date: d.date,
      weekday: dt.toLocaleDateString(undefined, { weekday: 'short' }),
      dateLabel: dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      delivered: d.delivered || 0,
      warning: d.warning || 0,
      failed: d.failed || 0,
      isToday: d.date === today,
    }
  }), [days, today])

  const dayCount = chartData.length
  const barMaxWidth = dayCount > 14 ? 32 : 64
  // Thin out x-axis labels as the range grows so they don't overlap.
  const tickInterval = dayCount > 14 ? 3 : dayCount > 7 ? 1 : 0
  const AxisTick = useMemo(() => makeTick(chartData), [chartData])

  if (loading && !data) {
    return (
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">{[1, 2, 3].map(i => <div key={i} className="skeleton flex-1 h-16 rounded-lg" />)}</div>
          <div className="skeleton h-48 rounded-lg" />
        </div>
      </Card>
    )
  }

  return (
    <Card>
      {/* Tally stats (daisyUI) — colour coding kept on the values */}
      <div className="stats stats-horizontal w-full mb-4 shadow-none border border-solid" style={{ borderColor: GRAY_200 }}>
        <div className="stat">
          <div className="stat-title">Delivered</div>
          <div className="stat-value text-[clamp(22px,3vw,30px)]" style={{ color: EMERALD_700 }}>{totals.delivered}</div>
        </div>
        <div className="stat" style={{ opacity: totals.warning === 0 ? 0.5 : 1 }}>
          <div className="stat-title">With warnings</div>
          <div className="stat-value text-[clamp(22px,3vw,30px)]" style={{ color: AMBER_700 }}>{totals.warning}</div>
        </div>
        <div className="stat" style={{ opacity: totals.failed === 0 ? 0.5 : 1 }}>
          <div className="stat-title">Couldn't deliver</div>
          <div className="stat-value text-[clamp(22px,3vw,30px)]" style={{ color: ROSE_700 }}>{totals.failed}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Avg fetch time</div>
          <div className="stat-value text-[clamp(22px,3vw,30px)]" style={{ color: GRAY_900 }}>
            {totals.avg_fetch_seconds}<span className="text-[14px] font-normal ml-1" style={{ color: GRAY_400 }}>s</span>
          </div>
        </div>
      </div>

      {/* Chart — recharts stacked bars */}
      <div style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 8, left: -18, bottom: 0 }}
          >
            <CartesianGrid vertical={false} stroke={GRAY_100} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              interval={tickInterval}
              height={44}
              tick={<AxisTick />}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={30}
              tick={{ fontSize: 11, fill: GRAY_400 }}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            <Bar dataKey="delivered" stackId="a" fill={EMERALD_500} maxBarSize={barMaxWidth} />
            <Bar dataKey="warning" stackId="a" fill={AMBER_500} maxBarSize={barMaxWidth} />
            <Bar dataKey="failed" stackId="a" fill={ROSE_500} maxBarSize={barMaxWidth} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ background: EMERALD_500 }} />
            <span className="text-[12px]" style={{ color: GRAY_500 }}>Delivered</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ background: AMBER_500 }} />
            <span className="text-[12px]" style={{ color: GRAY_500 }}>With warnings</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ background: ROSE_500 }} />
            <span className="text-[12px]" style={{ color: GRAY_500 }}>Couldn't deliver</span>
          </div>
        </div>
      </div>
    </Card>
  )
}
