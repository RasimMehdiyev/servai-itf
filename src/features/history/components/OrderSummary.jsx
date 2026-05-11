import React, { useState, useEffect, useRef, useCallback } from 'react'
import Card from '../../../components/ui/Card'
import OrderListItem from '../../day-details/components/OrderListItem'

const PAGE_SIZE = 10

const SKELETON_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 'clamp(10px, 1.6vw, 14px)',
  background: 'var(--surface)',
  borderRadius: 'var(--radius-md, 10px)',
  boxShadow: 'var(--shadow-card)',
  minHeight: 56,
}

const PULSE_STYLE = {
  background: 'var(--border)',
  borderRadius: 6,
  animation: 'skeleton-pulse 1.2s ease-in-out infinite',
}

function OrderSkeleton() {
  return (
    <div style={SKELETON_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ ...PULSE_STYLE, width: 20, height: 20 }} />
        <div>
          <div style={{ ...PULSE_STYLE, width: 100, height: 14, marginBottom: 6 }} />
          <div style={{ ...PULSE_STYLE, width: 60, height: 10 }} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ ...PULSE_STYLE, width: 36, height: 12 }} />
        <div style={{ ...PULSE_STYLE, width: 22, height: 22, borderRadius: '50%' }} />
      </div>
    </div>
  )
}

export default function OrderSummary({ title, selectedDay, onClearDay, orders, chartMode }) {
  const isFail = chartMode === 'failures'
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [loading, setLoading] = useState(false)
  const sentinelRef = useRef(null)

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
    setLoading(false)
  }, [selectedDay, chartMode])

  const hasMore = orders.length > visibleCount

  const loadMore = useCallback(() => {
    if (!hasMore || loading) return
    setLoading(true)
    setTimeout(() => {
      setVisibleCount(c => c + PAGE_SIZE)
      setLoading(false)
    }, 400)
  }, [hasMore, loading])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore() },
      { rootMargin: '100px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  const visibleOrders = orders.slice(0, visibleCount)

  return (
    <Card>
      <style>{`
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <div className="gap-row" style={{ margin: 0 }}>
          {selectedDay ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--text-secondary)" aria-hidden><path d="M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6-2c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2zm6 16H6V8h2v2h2V8h4v2h2V8h2v12z"/></svg>
          ) : isFail ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--danger)" aria-hidden><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 5h2v6h-2V7zm0 8h2v2h-2v-2z"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--success)" aria-hidden><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
          )}
          <h2 style={{ fontSize: 'clamp(16px,2.2vw,19px)', fontWeight: 600, margin: 0 }}>{title || 'Summary'}</h2>
        </div>
        {selectedDay && (
          <button
            onClick={onClearDay}
            style={{
              border: '1px solid var(--border)',
              borderStyle: 'solid',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 12,
              color: 'var(--text-secondary)',
              background: 'var(--surface)',
              cursor: 'pointer',
            }}
          >
            ← Show all
          </button>
        )}
      </div>

      {orders.length > 0 ? (
        <div className="order-list">
          {visibleOrders.map(order => (
            <OrderListItem key={order.id} order={order} />
          ))}
          {loading && (
            <>
              <OrderSkeleton />
              <OrderSkeleton />
              <OrderSkeleton />
            </>
          )}
          {hasMore && !loading && <div ref={sentinelRef} style={{ height: 1 }} />}
        </div>
      ) : (
        <p className="text-muted text-sm">
          {selectedDay
            ? 'No orders recorded on this day.'
            : isFail
              ? 'No failures recorded in this period.'
              : 'No successful orders in this period.'}
        </p>
      )}
    </Card>
  )
}
