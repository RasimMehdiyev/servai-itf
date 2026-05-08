import React, { useState } from 'react'
import Card from '../../../components/ui/Card'

// ── Bullet-state icon ──────────────────────────────────────────────────────

function BulletIcon({ state }) {
  if (state === 'completed')
    return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--success)] shrink-0 mt-0.5" aria-hidden><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
  if (state === 'warning')
    return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--danger)] shrink-0 mt-0.5" aria-hidden><circle cx="12" cy="12" r="10"/></svg>
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--text-tertiary)] shrink-0 mt-0.5" aria-hidden><circle cx="12" cy="12" r="6"/></svg>
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AttentionPanel({ title, level, explanationTitle, explanationText, bullets, onFulfillManually, onOpenCamera, style }) {
  const [fulfilled, setFulfilled] = useState(false)
  const isOk = level === 'ok'

  const handleFulfill = () => {
    setFulfilled(true)
    onFulfillManually?.()
  }

  return (
    <Card style={style}>
      {/* ── Title + status chip ── */}
      <div className="flex justify-between items-start gap-3">
        <h2 className="text-[clamp(20px,2.4vw,24px)] font-bold text-[var(--text-primary)]">{title}</h2>
        {isOk
          ? <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[clamp(14px,1.7vw,15px)] font-semibold bg-[var(--success-bg)] text-[var(--success)] shrink-0">✓ All Clear</span>
          : <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[clamp(14px,1.7vw,15px)] font-semibold bg-[var(--danger-bg)] text-[var(--danger)] shrink-0">⚠ Needs Attention</span>
        }
      </div>

      {/* ── Why card ── */}
      <div className="bg-[var(--bg)] rounded-[10px] p-[clamp(10px,1.6vw,16px)] mt-3 border-l-[3px] border-solid border-[var(--danger)]">
        <div className="flex items-center gap-2 mb-1.5">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--danger)]" aria-hidden>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 5h2v6h-2V7zm0 8h2v2h-2v-2z"/>
          </svg>
          <strong className="text-[clamp(16px,2.0vw,17px)]">{explanationTitle}</strong>
        </div>
        <p className="text-[var(--text-secondary)] text-[clamp(15px,1.7vw,16px)]">{explanationText}</p>
      </div>

      {/* ── Bullet list ── */}
      <ul className="list-none flex flex-col gap-2 mt-3 p-0">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[clamp(16px,2.0vw,17px)]">
            <BulletIcon state={b.state} />
            <span>{b.text}</span>
          </li>
        ))}
      </ul>

      {/* ── Action buttons ── */}
      {!isOk && !fulfilled && (
        <div className="flex gap-2.5 flex-wrap mt-3">
          <button
            className="flex-1 min-w-[160px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[6px] bg-[var(--primary)] text-white font-semibold text-[clamp(16px,2.0vw,17px)] min-h-[44px] border border-solid border-[var(--primary)] cursor-pointer transition-shadow hover:shadow-[0_2px_8px_rgba(43,127,255,.3)]"
            onClick={handleFulfill}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v6M10 10V5a2 2 0 0 0-4 0v9"/>
              <path d="M18 11a2 2 0 0 1 4 0v5a8 8 0 0 1-8 8h-2c-2.5 0-4.5-1-6.2-2.8L2.5 17a1.5 1.5 0 0 1 2.1-2.1L6 16.4"/>
            </svg>
            Fulfill Order Manually
          </button>
          <button
            className="flex-1 min-w-[160px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[6px] bg-[var(--surface)] text-[var(--text-primary)] font-semibold text-[clamp(16px,2.0vw,17px)] min-h-[44px] border border-solid border-[var(--border)] cursor-pointer transition-colors hover:bg-[var(--bg)]"
            onClick={onOpenCamera}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            View Camera Feed
          </button>
        </div>
      )}

      {/* ── Fulfilled toast ── */}
      {fulfilled && (
        <div className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[6px] text-[clamp(15px,1.7vw,16px)] font-medium bg-[var(--success-bg)] text-[var(--success)] mt-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5"/></svg>
          Manual fulfillment initiated — robot set to idle
        </div>
      )}
    </Card>
  )
}

