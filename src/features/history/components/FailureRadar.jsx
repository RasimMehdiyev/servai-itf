import React, { useState, useEffect, useMemo } from 'react'
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend, ResponsiveContainer,
} from 'recharts'
import Card from '../../../components/ui/Card'
import { getApiBase } from '../../../lib/urls'

// Same palette + failure-reason labels as OrdersList, so the page stays
// colour-consistent: rose = couldn't deliver, amber = delivered with warnings.
const ROSE_500 = '#f43f5e'
const AMBER_500 = '#ca8a04'
const GRAY_200 = '#e5e7eb'
const GRAY_400 = '#9ca3af'
const GRAY_500 = '#6b7280'
const GRAY_700 = '#374151'
const GRAY_900 = '#111827'

const DATA_BASE = getApiBase()

const REASON_SHORT = {
  search_exhausted: 'Not found',
  reachability_failed: 'Path blocked',
  no_valid_depth: 'Depth failed',
  handover_failed: 'Handover blocked',
  user_cancelled: 'Cancelled',
  gripper_failed: 'Grip failed',
  e_stopped: 'E-stop',
  timeout: 'Timeout',
  operator_abort: 'Operator aborted',
  bridge_fault: 'Hardware fault',
  unknown: 'Unknown',
}

// Brief, lay-user explanations grounded in what each failure actually means for
// ROBI (mirrors the failure semantics in ws-test-server.js / the RAG server).
const FAILURE_EXPLANATIONS = {
  search_exhausted: "ROBI checked every shelf location it knows and still couldn't find the item — usually it's out of stock, hidden behind other things, or not where it was expected.",
  reachability_failed: "ROBI found the item but couldn't plan a safe path for its arm to reach it — something was in the way, or the item sat outside the arm's comfortable range.",
  no_valid_depth: "ROBI's depth camera couldn't get a reliable distance reading on the item. This usually happens with shiny, dark, or see-through surfaces that confuse the sensor.",
  handover_failed: "ROBI picked the item up but couldn't finish handing it to the customer — the handover position was blocked or the motion was interrupted.",
  gripper_failed: "ROBI's gripper didn't open or close as expected when grabbing or releasing, so the pick couldn't be trusted.",
  e_stopped: 'The emergency stop was triggered, which instantly freezes ROBI for safety until a person resets it.',
  timeout: 'A step took longer than allowed, so ROBI stopped rather than stay stuck — often a sign an earlier step quietly went wrong.',
  operator_abort: 'A person manually stopped the handover part-way through (for example an interrupt on the controller).',
  user_cancelled: 'The order was cancelled before ROBI could finish it.',
  bridge_fault: "A brief hardware or communication glitch on ROBI's control bridge. These are usually temporary and recover on their own.",
  unknown: "ROBI recorded a problem it couldn't categorise — check the order's step-by-step detail and camera feed to see what happened.",
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// Clickable angle-axis label. recharts injects x/y/payload/textAnchor; we add
// the click handler + selected styling.
function AngleTick({ x, y, payload, textAnchor, chartData, selectedKey, onSelect }) {
  const d = chartData.find(r => r.reason === payload.value)
  if (!d) return null
  const active = d.key === selectedKey
  return (
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      dominantBaseline="central"
      onClick={() => onSelect(d.key)}
      style={{ cursor: 'pointer', outline: 'none' }}
      fontSize={11}
      fontWeight={active ? 700 : 500}
      fill={active ? ROSE_500 : GRAY_500}
      textDecoration="underline"
      textDecorationStyle="dotted"
    >
      {d.reason}
    </text>
  )
}

export default function FailureRadar({ dateFrom, dateTo }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedKey, setSelectedKey] = useState(null)

  const from = dateFrom || todayStr()
  const to = dateTo || todayStr()

  // Pull the whole range (unfiltered) so the radar reflects every issue, not
  // whatever the orders-list chips happen to be filtering to.
  useEffect(() => {
    setLoading(true)
    fetch(`${DATA_BASE}/api/orders/list?from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [from, to])

  const { chartData, totalFailures } = useMemo(() => {
    const orders = data?.orders || []
    const tally = {}   // reason -> { failed, warning }
    for (const o of orders) {
      if (o.status !== 'failed' && o.status !== 'warning') continue
      const reason = o.failure?.reason || 'unknown'
      if (!tally[reason]) tally[reason] = { failed: 0, warning: 0 }
      tally[reason][o.status === 'failed' ? 'failed' : 'warning']++
    }
    const rows = Object.entries(tally)
      .map(([reason, c]) => ({
        key: reason,
        reason: REASON_SHORT[reason] || reason.replace(/_/g, ' '),
        failed: c.failed,
        warning: c.warning,
        total: c.failed + c.warning,
      }))
      .sort((a, b) => b.total - a.total)
    return { chartData: rows, totalFailures: rows.reduce((s, r) => s + r.total, 0) }
  }, [data])

  // Default to the most frequent failure so the panel is never empty, and keep
  // the selection valid as the date range changes.
  useEffect(() => {
    if (!chartData.length) { setSelectedKey(null); return }
    setSelectedKey(prev => (prev && chartData.some(r => r.key === prev)) ? prev : chartData[0].key)
  }, [chartData])

  const selected = chartData.find(r => r.key === selectedKey) || null

  if (loading && !data) {
    return (
      <Card>
        <div className="skeleton h-6 w-40 rounded mb-3" />
        <div className="skeleton rounded-xl" style={{ height: 260 }} />
      </Card>
    )
  }

  return (
    <Card>
      <div className="mb-2">
        <h2 className="text-[clamp(16px,2.2vw,19px)] font-semibold" style={{ color: GRAY_900, margin: 0 }}>Failure breakdown</h2>
        <div className="text-[12px]" style={{ color: GRAY_500 }}>Which issues happen most often — tap a point to see what it means</div>
      </div>

      {totalFailures === 0 ? (
        <div className="flex flex-col items-center justify-center text-center" style={{ height: 260 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={GRAY_400} strokeWidth="1.5" className="mb-2">
            <circle cx="12" cy="12" r="10" /><path d="M8 12l3 3 5-6" />
          </svg>
          <div className="text-[13px]" style={{ color: GRAY_500 }}>No issues in this range — every order went smoothly.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'stretch' }}>
          {/* Radar */}
          <div style={{ flex: '1 1 320px', minWidth: 0, height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={chartData} outerRadius="68%">
                <PolarGrid stroke={GRAY_200} />
                <PolarAngleAxis
                  dataKey="reason"
                  tick={<AngleTick chartData={chartData} selectedKey={selectedKey} onSelect={setSelectedKey} />}
                />
                <PolarRadiusAxis angle={90} tick={{ fontSize: 10, fill: GRAY_400 }} allowDecimals={false} />
                <Radar name="Couldn't deliver" dataKey="failed" stroke={ROSE_500} fill={ROSE_500} fillOpacity={0.35} />
                <Radar name="With warnings" dataKey="warning" stroke={AMBER_500} fill={AMBER_500} fillOpacity={0.25} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Explanation panel (right) */}
          <div style={{ flex: '1 1 240px', minWidth: 0 }} className="flex flex-col justify-center gap-3">
            {selected ? (
              <>
                <div>
                  <div className="text-[15px] font-semibold mb-1.5" style={{ color: GRAY_900 }}>{selected.reason}</div>
                  <div className="flex flex-wrap gap-2">
                    {selected.failed > 0 && (
                      <span className="badge badge-sm badge-error badge-outline">{selected.failed} couldn't deliver</span>
                    )}
                    {selected.warning > 0 && (
                      <span className="badge badge-sm badge-warning badge-outline">{selected.warning} with warnings</span>
                    )}
                  </div>
                </div>
                <div className="alert" style={{ alignItems: 'flex-start' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GRAY_500} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
                  </svg>
                  <span className="text-[13px] leading-relaxed" style={{ color: GRAY_700 }}>
                    {FAILURE_EXPLANATIONS[selected.key] || FAILURE_EXPLANATIONS.unknown}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-[13px] text-center" style={{ color: GRAY_400 }}>
                Tap a failure on the chart to see what it means.
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
