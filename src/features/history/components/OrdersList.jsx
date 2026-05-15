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
const GRAY_700 = '#374151'
const GRAY_900 = '#111827'
const TEAL_200 = '#99f6e4'

// Order data comes from the WS server (always available)
const wsUrl = import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:8765`
const DATA_BASE = wsUrl.replace(/^ws/, 'http').replace(/\/$/, '')
const PAGE_SIZE = 5

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function formatTime(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatDateLabel(dateStr) {
  const today = todayStr()
  const d = new Date(dateStr + 'T12:00:00')
  const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (dateStr === today) return `Today · ${label}`
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (dateStr === yesterday.toISOString().slice(0, 10)) return `Yesterday · ${label}`
  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' })
  return `${weekday} · ${label}`
}

function StatusIcon({ status }) {
  if (status === 'success' || status === 'ok') {
    return (
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-solid" style={{ background: EMERALD_50, borderColor: EMERALD_100 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={EMERALD_500} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    )
  }
  if (status === 'warning') {
    return (
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-solid" style={{ background: AMBER_50, borderColor: AMBER_100 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={AMBER_500} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-solid" style={{ background: ROSE_50, borderColor: ROSE_100 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ROSE_500} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </div>
    )
  }
  return (
    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-solid" style={{ background: GRAY_50, borderColor: GRAY_200 }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GRAY_400} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    </div>
  )
}

const REASON_SHORT = {
  search_exhausted: 'Not found',
  reachability_failed: 'Path blocked',
  no_valid_depth: 'Depth failed',
  handover_failed: 'Handover blocked',
  user_cancelled: 'Cancelled',
  gripper_failed: 'Grip failed',
  e_stopped: 'E-stop',
  timeout: 'Timeout',
}

function StatusPill({ status, failure }) {
  if (status === 'success' || status === 'ok') {
    return <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: EMERALD_50, color: EMERALD_700, border: `1px solid ${EMERALD_100}` }}>Delivered</span>
  }
  const reasonLabel = failure?.reason ? REASON_SHORT[failure.reason] : null
  if (status === 'warning') {
    return <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: AMBER_50, color: AMBER_700, border: `1px solid ${AMBER_100}` }}>{reasonLabel || 'Warning'}</span>
  }
  if (status === 'failed') {
    return <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: ROSE_50, color: ROSE_700, border: `1px solid ${ROSE_100}` }}>{reasonLabel || 'Failed'}</span>
  }
  return <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: GRAY_50, color: GRAY_500, border: `1px solid ${GRAY_200}` }}>Unknown</span>
}

function formatMeta(phase) {
  const meta = phase.meta || {}
  if (!meta || Object.keys(meta).length === 0 || (Object.keys(meta).length === 1 && meta.raw_event_count != null)) return null
  const parts = []
  if (meta.candidates != null) parts.push(`${meta.candidates} candidates`)
  if (meta.chosen_score != null) parts.push(`score ${meta.chosen_score}`)
  if (meta.chosen_distance_cm != null) parts.push(`${meta.chosen_distance_cm}cm away`)
  if (meta.molmo_points != null) parts.push(`${meta.molmo_points} grasp points`)
  if (meta.grasp_width_mm != null) parts.push(`${meta.grasp_width_mm}mm grip`)
  if (meta.depth_offset_mm != null) parts.push(`${meta.depth_offset_mm}mm depth offset`)
  if (meta.gripper_opening != null) parts.push(`gripper ${meta.gripper_opening}`)
  if (meta.success === true) parts.push('grip OK')
  if (meta.success === false) parts.push('grip failed')
  if (meta.target_waypoint) parts.push(`→ ${meta.target_waypoint}`)
  return parts.length > 0 ? parts.join(', ') : null
}

function StepIcon({ status }) {
  if (status === 'failed') {
    return (
      <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: ROSE_50, border: `1px solid ${ROSE_100}` }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={ROSE_500} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </div>
    )
  }
  if (status === 'warning') {
    return (
      <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: AMBER_50, border: `1px solid ${AMBER_100}` }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={AMBER_500} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
    )
  }
  return (
    <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: EMERALD_50, border: `1px solid ${EMERALD_100}` }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={EMERALD_500} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
  )
}

function ExpandedDetail({ order, onAskRobi }) {
  const phases = order.phases || []

  return (
    <div className="px-4 py-4 border-t border-solid" style={{ borderColor: TEAL_200, background: 'white' }}>
      <div className="text-[13px] font-semibold mb-3" style={{ color: GRAY_900 }}>Step-by-step</div>
      <div className="flex flex-col gap-2.5">
        {phases.map((phase, i) => {
          const metaText = formatMeta(phase)
          const failPhase = order.failure?.at_phase
          const stepStatus = phase.status || (failPhase === phase.phase ? (order.status === 'warning' ? 'warning' : 'failed') : 'ok')
          const nameColor = stepStatus === 'failed' ? ROSE_700 : stepStatus === 'warning' ? AMBER_700 : GRAY_900
          return (
            <div key={i} className="flex items-start gap-3">
              <StepIcon status={stepStatus} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px]" style={{ color: nameColor }}>
                  {phase.friendly_name || phase.phase}
                </div>
                {phase.failure_detail && (
                  <div className="text-[11px] mt-0.5" style={{ color: stepStatus === 'failed' ? ROSE_500 : AMBER_500 }}>{phase.failure_detail}</div>
                )}
                {metaText && (
                  <div className="text-[11px] mt-0.5" style={{ color: GRAY_400 }}>{metaText}</div>
                )}
              </div>
              <div className="text-[12px] font-mono shrink-0" style={{ color: GRAY_500 }}>
                {phase.duration_seconds}s
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-solid" style={{ borderColor: GRAY_200 }}>
        <button
          onClick={() => onAskRobi?.(order)}
          className="px-3 py-2 rounded-lg text-[12px] font-semibold border-0 cursor-pointer hover:opacity-90"
          style={{ background: 'var(--teal, #0d9488)', color: 'white' }}
        >
          {order.status === 'failed' ? 'Why did you fail?' : 'Why so long? Ask ROBI'}
        </button>
        <span className="text-[12px] cursor-pointer hover:underline" style={{ color: GRAY_400 }}>
          View full log →
        </span>
      </div>
    </div>
  )
}

export default function OrdersList({ dateFrom, dateTo, onCitationClick, onAskRobi }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [itemFilter, setItemFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [expandedGroups, setExpandedGroups] = useState({})

  const from = dateFrom || todayStr()
  const to = dateTo || todayStr()

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ from, to, status: statusFilter, item: itemFilter })
    fetch(`${DATA_BASE}/api/orders/list?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [from, to, statusFilter, itemFilter])

  // Reset filters when date range changes
  useEffect(() => {
    setStatusFilter('all')
    setItemFilter('all')
    setExpandedId(null)
    setExpandedGroups({})
  }, [from, to])

  const { caption, loading: captionLoading, error: captionError } = useRagCaption('orders_list', { from, to, status: statusFilter })

  const counts = data?.counts || { all: 0, delivered: 0, warning: 0, failed: 0, by_item: {} }
  const orders = data?.orders || []

  // Group orders by date
  const grouped = useMemo(() => {
    const groups = {}
    for (const o of orders) {
      const date = (o.completed_at || o.started_at || '').slice(0, 10)
      if (!groups[date]) groups[date] = []
      groups[date].push(o)
    }
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]))
  }, [orders])

  const itemChips = useMemo(() => {
    return Object.entries(counts.by_item || {}).sort((a, b) => b[1] - a[1])
  }, [counts.by_item])

  function chipStyle(active) {
    return active
      ? { background: GRAY_900, color: 'white', borderColor: GRAY_900 }
      : { background: 'white', color: GRAY_700, borderColor: GRAY_200 }
  }

  const totalInRange = counts.all
  const rangeDays = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1)
  const rangeLabel = rangeDays <= 1 ? 'today' : rangeDays <= 7 ? `the last ${rangeDays} days` : `the last ${rangeDays} days`

  if (loading && !data) {
    return (
      <Card>
        <div className="animate-pulse flex flex-col gap-3">
          <div className="h-6 w-48 rounded" style={{ background: GRAY_100 }} />
          <div className="flex gap-2">{[1, 2, 3].map(i => <div key={i} className="h-8 w-20 rounded-full" style={{ background: GRAY_100 }} />)}</div>
          {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-lg" style={{ background: GRAY_50 }} />)}
        </div>
      </Card>
    )
  }

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-[clamp(16px,2.2vw,19px)] font-semibold" style={{ color: GRAY_900, margin: 0 }}>Orders</h2>
          <div className="text-[12px]" style={{ color: GRAY_500 }}>{totalInRange} in {rangeLabel}</div>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <button
          onClick={() => { setStatusFilter('all'); setItemFilter('all') }}
          className="px-3 py-1.5 rounded-full text-[12px] font-medium border border-solid cursor-pointer"
          style={chipStyle(statusFilter === 'all' && itemFilter === 'all')}
        >
          All <span style={{ color: statusFilter === 'all' && itemFilter === 'all' ? 'rgba(255,255,255,0.6)' : GRAY_400 }}>{counts.all}</span>
        </button>
        <button
          onClick={() => { setStatusFilter('delivered'); setItemFilter('all') }}
          className="px-3 py-1.5 rounded-full text-[12px] font-medium border border-solid cursor-pointer"
          style={chipStyle(statusFilter === 'delivered')}
        >
          ✓ Delivered <span style={{ color: statusFilter === 'delivered' ? 'rgba(255,255,255,0.6)' : GRAY_400 }}>{counts.delivered}</span>
        </button>
        <button
          onClick={() => { setStatusFilter('warning'); setItemFilter('all') }}
          className="px-3 py-1.5 rounded-full text-[12px] font-medium border border-solid cursor-pointer"
          style={{ ...chipStyle(statusFilter === 'warning'), opacity: counts.warning === 0 ? 0.6 : 1 }}
        >
          ⚠ Warnings <span style={{ color: statusFilter === 'warning' ? 'rgba(255,255,255,0.6)' : GRAY_400 }}>{counts.warning}</span>
        </button>
        <button
          onClick={() => { setStatusFilter('failed'); setItemFilter('all') }}
          className="px-3 py-1.5 rounded-full text-[12px] font-medium border border-solid cursor-pointer"
          style={{ ...chipStyle(statusFilter === 'failed'), opacity: counts.failed === 0 ? 0.6 : 1 }}
        >
          ✕ Failed <span style={{ color: statusFilter === 'failed' ? 'rgba(255,255,255,0.6)' : GRAY_400 }}>{counts.failed}</span>
        </button>

        {itemChips.length > 0 && (
          <>
            <div style={{ width: 1, height: 16, background: GRAY_200, margin: '0 4px' }} />
            {itemChips.map(([name, count]) => (
              <button
                key={name}
                onClick={() => { setItemFilter(itemFilter === name ? 'all' : name); setStatusFilter('all') }}
                className="px-3 py-1.5 rounded-full text-[12px] font-medium border border-solid cursor-pointer"
                style={chipStyle(itemFilter === name)}
              >
                {name} <span style={{ color: itemFilter === name ? 'rgba(255,255,255,0.6)' : GRAY_400 }}>{count}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {/* AI caption */}
      <AiCaption
        caption={caption}
        loading={captionLoading}
        error={captionError}
        onCitationClick={onCitationClick}
      />

      {/* Orders grouped by date */}
      <div className="mt-4 flex flex-col gap-4">
        {orders.length === 0 ? (
          <div className="text-center py-8">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={GRAY_400} strokeWidth="1.5" className="mx-auto mb-2">
              <rect x="2" y="3" width="20" height="18" rx="2" />
              <path d="M8 7h8M8 11h5" />
            </svg>
            <div className="text-[13px]" style={{ color: GRAY_500 }}>
              {statusFilter !== 'all' || itemFilter !== 'all'
                ? 'No orders match these filters.'
                : from === to ? 'No orders in this range.' : "ROBI hasn't completed any orders yet. Once it does, they'll show up here."}
            </div>
            {(statusFilter !== 'all' || itemFilter !== 'all') && (
              <button
                onClick={() => { setStatusFilter('all'); setItemFilter('all') }}
                className="mt-2 text-[12px] font-medium cursor-pointer border-0 bg-transparent"
                style={{ color: 'var(--teal, #0d9488)' }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          grouped.map(([date, dateOrders]) => {
            const isExpanded = expandedGroups[date]
            const visibleOrders = isExpanded ? dateOrders : dateOrders.slice(0, PAGE_SIZE)
            const remaining = dateOrders.length - PAGE_SIZE

            return (
              <div key={date}>
                {/* Date divider */}
                <div className="flex items-center gap-3 mb-2.5">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] shrink-0" style={{ color: GRAY_500 }}>
                    {formatDateLabel(date)}
                  </span>
                  <div className="flex-1 border-t border-solid" style={{ borderColor: GRAY_200 }} />
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] shrink-0" style={{ color: GRAY_500 }}>
                    {dateOrders.length} order{dateOrders.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Order rows */}
                <div className="flex flex-col gap-1.5">
                  {visibleOrders.map(order => {
                    const isOpen = expandedId === order.id
                    return (
                      <div key={order.id} id={`order-${order.id}`}>
                        <div
                          className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-solid cursor-pointer transition-all"
                          style={{
                            background: isOpen ? 'white' : GRAY_50,
                            borderColor: isOpen ? TEAL_200 : GRAY_100,
                            boxShadow: isOpen ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
                          }}
                          onClick={() => setExpandedId(isOpen ? null : order.id)}
                        >
                          <StatusIcon status={order.status} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-semibold" style={{ color: GRAY_900 }}>
                              {order.item}
                            </div>
                            <div className="text-[11px]" style={{ color: GRAY_400 }}>
                              Order #{order.order_number || order.id}
                            </div>
                            <div className="text-[11px] mt-0.5" style={{ color: GRAY_500 }}>
                              Took {order.robot_seconds}s · {order.status === 'success' || order.status === 'ok' ? 'handed over' : 'ended'} at {formatTime(order.completed_at || order.started_at)}
                            </div>
                          </div>
                          <StatusPill status={order.status} failure={order.failure} />
                          <svg
                            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GRAY_400} strokeWidth="2"
                            style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease', shrinkFlexGrow: 0 }}
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </div>
                        {isOpen && <ExpandedDetail order={order} onAskRobi={onAskRobi} />}
                      </div>
                    )
                  })}
                </div>

                {/* Pagination */}
                {!isExpanded && remaining > 0 && (
                  <button
                    onClick={() => setExpandedGroups(prev => ({ ...prev, [date]: true }))}
                    className="mt-2 text-[12px] font-medium cursor-pointer border-0 bg-transparent w-full text-center py-1.5"
                    style={{ color: 'var(--teal, #0d9488)' }}
                  >
                    Show {remaining} more from {formatDateLabel(date).split(' · ')[0].toLowerCase()} →
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </Card>
  )
}
