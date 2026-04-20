import React, { useState } from 'react'
import Card from '../../../components/ui/Card'
import StatusChip from '../../../components/ui/StatusChip'

const iconFor = (state) => {
  if (state === 'completed') return <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--success)" aria-hidden><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
  if (state === 'warning') return <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--warning)" aria-hidden><circle cx="12" cy="12" r="10"/></svg>
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--text-tertiary)" aria-hidden><circle cx="12" cy="12" r="6"/></svg>
}

export default function AttentionPanel({ title, level, explanationTitle, explanationText, bullets, onFulfillManually, onOpenCamera }) {
  const [fulfilled, setFulfilled] = useState(false)
  const isOk = level === 'ok'

  const handleFulfill = () => {
    setFulfilled(true)
    onFulfillManually?.()
  }

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <h2 style={{ fontSize: 'clamp(16px,2vw,20px)', fontWeight: 700 }}>{title}</h2>
        {!isOk && <StatusChip label="Needs Attention" variant="warning" icon="⚠" />}
        {isOk && <StatusChip label="All Clear" variant="success" icon="✓" />}
      </div>

      <div className="why-card">
        <div className="gap-row" style={{ marginBottom: 6 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--warning)" aria-hidden><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 5h2v6h-2V7zm0 8h2v2h-2v-2z"/></svg>
          <strong>{explanationTitle}</strong>
        </div>
        <p className="text-muted text-sm">{explanationText}</p>
      </div>

      <ul className="bullet-list mt-md">
        {bullets.map((b, i) => (
          <li key={i}>
            {iconFor(b.state)}
            <span>{b.text}</span>
          </li>
        ))}
      </ul>

      {/* ---- Two prominent dashboard actions ---- */}
      {!isOk && !fulfilled && (
        <div className="attention-actions mt-md">
          <button className="quick-action-btn quick-action-btn--primary attention-actions__btn" onClick={handleFulfill}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v6M10 10V5a2 2 0 0 0-4 0v9"/>
              <path d="M18 11a2 2 0 0 1 4 0v5a8 8 0 0 1-8 8h-2c-2.5 0-4.5-1-6.2-2.8L2.5 17a1.5 1.5 0 0 1 2.1-2.1L6 16.4"/>
            </svg>
            Fulfill Order Manually
          </button>
          <button className="quick-action-btn quick-action-btn--outline attention-actions__btn" onClick={onOpenCamera}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            View Camera Feed
          </button>
        </div>
      )}

      {fulfilled && (
        <div className="action-toast action-toast--confirm mt-md">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5"/></svg>
          Manual fulfillment initiated — robot set to idle
        </div>
      )}
    </Card>
  )
}
