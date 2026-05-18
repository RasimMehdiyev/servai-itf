import React, { useState, useEffect, useMemo } from 'react'
import Card from '../../../components/ui/Card'
import AiCaption from './AiCaption'
import useRagCaption from '../../../hooks/useRagCaption'

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
const TEAL_100 = '#ccfbf1'
const TEAL_700 = '#0f766e'

import { getApiBase } from '../../../lib/urls'

// Order data comes from the WS server (always available)
const DATA_BASE = getApiBase()

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export default function ActivityChart({ dateFrom, dateTo, onCitationClick }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hoveredIdx, setHoveredIdx] = useState(null)

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

  // Build stats object from loaded data so the LLM prompt uses the same numbers
  const captionStats = useMemo(() => {
    if (!data) return null
    return {
      total: totals.delivered + totals.warning + totals.failed,
      delivered: totals.delivered,
      warning: totals.warning,
      failed: totals.failed,
      avg_fetch_seconds: totals.avg_fetch_seconds,
    }
  }, [data, totals.delivered, totals.warning, totals.failed, totals.avg_fetch_seconds])

  // AI caption — cached version arrives with the data, no extra fetch
  const {
    caption, loading: captionLoading, error: captionError,
    stale: captionStale,
    generate: generateCaption, refresh: refreshCaption,
  } = useRagCaption('chart', { from, to }, captionStats, data?.cached_caption)

  const days = useMemo(() => {
    const raw = data?.days || []
    const firstActive = raw.findIndex(d => d.delivered + d.failed > 0)
    if (firstActive <= 0) return raw
    return raw.slice(Math.max(0, firstActive - 1))
  }, [data])

  const { maxVal, yTicks } = useMemo(() => {
    const peak = Math.max(...days.map(d => (d.delivered || 0) + (d.warning || 0) + (d.failed || 0)), 1)
    let step
    if (peak <= 5) {
      step = 1
    } else {
      const rough = peak / 5
      const mag = Math.pow(10, Math.floor(Math.log10(rough)))
      const r = rough / mag
      step = r <= 1 ? mag : r <= 2 ? 2 * mag : r <= 5 ? 5 * mag : 10 * mag
    }
    const max = Math.ceil(peak / step) * step
    const ticks = []
    for (let i = 0; i <= max; i += step) ticks.push(i)
    return { maxVal: max, yTicks: ticks }
  }, [days])

  const today = todayStr()
  const dayCount = days.length
  const barWidth = dayCount > 14 ? 24 : dayCount > 7 ? 36 : 48
  const barMaxWidth = dayCount > 14 ? 32 : 64
  const showLabel = (i) => {
    if (dayCount <= 7) return true
    if (dayCount <= 14) return i % 2 === 0 || days[i]?.date === today
    return i % 4 === 0 || i === dayCount - 1 || days[i]?.date === today
  }

  if (loading && !data) {
    return (
      <Card>
        <div className="animate-pulse flex flex-col gap-3">
          <div className="flex gap-3">{[1, 2, 3].map(i => <div key={i} className="flex-1 h-16 rounded-lg" style={{ background: GRAY_100 }} />)}</div>
          <div className="h-48 rounded-lg" style={{ background: GRAY_100 }} />
        </div>
      </Card>
    )
  }

  return (
    <Card>
      {/* Tally tiles */}
      <div className="flex gap-3 mb-4" style={{ flexWrap: 'wrap' }}>
        <div
          className="flex-1 min-w-[120px] px-4 py-3 rounded-xl border border-solid"
          style={{ background: EMERALD_50, borderColor: EMERALD_100 }}
        >
          <div className="text-[12px] font-medium" style={{ color: EMERALD_700 }}>Delivered</div>
          <div className="text-[28px] font-bold leading-tight" style={{ color: EMERALD_700 }}>{totals.delivered}</div>
        </div>
        <div
          className="flex-1 min-w-[120px] px-4 py-3 rounded-xl border border-solid"
          style={{
            background: AMBER_50,
            borderColor: AMBER_100,
            opacity: totals.warning === 0 ? 0.5 : 1,
          }}
        >
          <div className="text-[12px] font-medium" style={{ color: AMBER_700 }}>With warnings</div>
          <div className="text-[28px] font-bold leading-tight" style={{ color: AMBER_700 }}>{totals.warning}</div>
        </div>
        <div
          className="flex-1 min-w-[120px] px-4 py-3 rounded-xl border border-solid"
          style={{
            background: ROSE_50,
            borderColor: ROSE_100,
            opacity: totals.failed === 0 ? 0.5 : 1,
          }}
        >
          <div className="text-[12px] font-medium" style={{ color: ROSE_700 }}>Couldn't deliver</div>
          <div className="text-[28px] font-bold leading-tight" style={{ color: ROSE_700 }}>{totals.failed}</div>
        </div>
        <div
          className="flex-1 min-w-[120px] px-4 py-3 rounded-xl border border-solid"
          style={{ background: GRAY_50, borderColor: GRAY_200 }}
        >
          <div className="text-[12px] font-medium" style={{ color: GRAY_500 }}>Avg fetch time</div>
          <div className="text-[28px] font-bold leading-tight" style={{ color: GRAY_900 }}>
            {totals.avg_fetch_seconds}<span className="text-[14px] font-normal ml-1" style={{ color: GRAY_400 }}>s</span>
          </div>
        </div>
      </div>

      {/* Chart area */}
      <div className="flex" style={{ minHeight: 220 }}>
        {/* Y-axis */}
        <div className="flex flex-col justify-between pr-2" style={{ width: 36, paddingBottom: 44 }}>
          {[...yTicks].reverse().map(v => (
            <div key={v} className="text-right text-[11px]" style={{ color: GRAY_400, lineHeight: '1' }}>{v}</div>
          ))}
        </div>

        {/* Bars */}
        <div className="flex-1 relative">
          {/* Grid lines */}
          <div className="absolute inset-0" style={{ bottom: 44 }}>
            {yTicks.map(v => (
              <div
                key={v}
                className="absolute w-full"
                style={{
                  bottom: `${(v / maxVal) * 100}%`,
                  borderBottom: `1px dashed ${GRAY_100}`,
                }}
              />
            ))}
          </div>

          {/* Bar columns */}
          <div className="flex justify-around items-stretch relative" style={{ height: 'calc(100% - 44px)' }}>
            {days.map((day, i) => {
              const warn = day.warning || 0
              const total = day.delivered + warn + day.failed
              const deliveredH = maxVal > 0 ? (day.delivered / maxVal) * 100 : 0
              const warningH = maxVal > 0 ? (warn / maxVal) * 100 : 0
              const failedH = maxVal > 0 ? (day.failed / maxVal) * 100 : 0
              const isToday = day.date === today

              return (
                <div
                  key={day.date}
                  className="flex flex-col items-center relative"
                  style={{ flex: 1, maxWidth: barMaxWidth }}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                >
                  {/* Today marker */}
                  {isToday && (
                    <div
                      className="absolute -top-6 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"
                      style={{ background: TEAL_100, color: TEAL_700 }}
                    >
                      Today
                    </div>
                  )}

                  {/* Tooltip */}
                  {hoveredIdx === i && total > 0 && (
                    <div
                      className="absolute z-10 px-2.5 py-1.5 rounded-lg text-[11px] whitespace-nowrap"
                      style={{
                        bottom: `${deliveredH + warningH + failedH + 8}%`,
                        background: GRAY_900,
                        color: 'white',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                        pointerEvents: 'none',
                      }}
                    >
                      {day.delivered} delivered{warn > 0 ? `, ${warn} with warnings` : ''}{day.failed > 0 ? `, ${day.failed} couldn't deliver` : ''}
                    </div>
                  )}

                  {/* Stacked bar */}
                  <div className="w-full flex flex-col items-center justify-end" style={{ height: '100%' }}>
                    <div style={{ width: barWidth, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                      {day.failed > 0 && (
                        <div
                          className="rounded-t-md bar-animate"
                          style={{
                            height: `${failedH}%`,
                            minHeight: 2,
                            background: ROSE_500,
                            animationDelay: `${i * 50}ms`,
                          }}
                        />
                      )}
                      {warn > 0 && (
                        <div
                          className={`${day.failed === 0 ? 'rounded-t-md' : ''} bar-animate`}
                          style={{
                            height: `${warningH}%`,
                            minHeight: 2,
                            background: AMBER_500,
                            animationDelay: `${i * 50}ms`,
                          }}
                        />
                      )}
                      {day.delivered > 0 && (
                        <div
                          className={`${day.failed === 0 && warn === 0 ? 'rounded-t-md' : ''} bar-animate`}
                          style={{
                            height: `${deliveredH}%`,
                            minHeight: 2,
                            background: EMERALD_500,
                            animationDelay: `${i * 50}ms`,
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* X-axis labels */}
          <div className="flex justify-around" style={{ height: 44, paddingTop: 6 }}>
            {days.map((day, i) => {
              const isToday = day.date === today
              const visible = showLabel(i)
              const d = new Date(day.date + 'T12:00:00')
              const weekday = d.toLocaleDateString(undefined, { weekday: 'short' })
              const dateLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              return (
                <div key={day.date} className="flex flex-col items-center" style={{ flex: 1, maxWidth: barMaxWidth }}>
                  {visible ? (
                    <>
                      <div className="text-[11px]" style={{ color: isToday ? GRAY_900 : GRAY_500, fontWeight: isToday ? 700 : 400 }}>
                        {weekday}
                      </div>
                      <div className="text-[10px]" style={{ color: GRAY_400 }}>{dateLabel}</div>
                    </>
                  ) : <div style={{ height: 28 }} />}
                </div>
              )
            })}
          </div>
        </div>
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

      {/* AI caption — loads independently, shows skeleton while waiting */}
      <AiCaption
        caption={caption}
        loading={captionLoading}
        error={captionError}
        stale={captionStale}
        onCitationClick={onCitationClick}
        onGenerate={generateCaption}
        onRefresh={refreshCaption}
      />

      <style>{`
        @keyframes barGrow {
          from { transform: scaleY(0); }
          to { transform: scaleY(1); }
        }
        .bar-animate {
          transform-origin: bottom;
          animation: barGrow 600ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
      `}</style>
    </Card>
  )
}
