import React from 'react'
import Card from '../../../components/ui/Card'

// ── Per-status styles ────────────────────────────────────────────────────────

const STATUS_CLS = {
  ok:      { dot: 'bg-[var(--success)]',     text: 'text-[var(--success)]',     bg: 'bg-[var(--success-bg)]' },
  warning: { dot: 'bg-[var(--danger)]',      text: 'text-[var(--danger)]',      bg: 'bg-[var(--danger-bg)]'  },
  error:   { dot: 'bg-[var(--danger)]',      text: 'text-[var(--danger)]',      bg: 'bg-[var(--danger-bg)]'  },
}

// ── Icons ────────────────────────────────────────────────────────────────────

const PARAM_ICONS = {
  drivetrain:   <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>,
  gripper:      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v6M10 10V5a2 2 0 0 0-4 0v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/><path d="M18 11a2 2 0 0 1 4 0v5a8 8 0 0 1-8 8h-2c-2.5 0-4.5-1-6.2-2.8L2.5 17a1.5 1.5 0 0 1 2.1-2.1L6 16.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/></svg>,
  camera:       <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4" fill="var(--surface)"/></svg>,
  depth_sensor: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>,
  shelf_sensor: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12z"/><path d="M6 10h12v2H6zm0 4h8v2H6z"/></svg>,
  force_sensor: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M11 15H6l7-14v8h5l-7 14v-8z"/></svg>,
  table_height: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M3 13h18v-2H3v2zm0 7h18v-2H3v2zm0-14h18V4H3v2z"/></svg>,
  sensors:      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V15h-2v1.93A8 8 0 0 1 4.07 11H6v-2H4.07A8 8 0 0 1 11 4.07V6h2V4.07A8 8 0 0 1 19.93 9H18v2h1.93A8 8 0 0 1 13 16.93z"/></svg>,
}

function ParamIcon({ paramKey }) {
  return (
    <span className="shrink-0 w-5 h-5 flex items-center justify-center">
      {PARAM_ICONS[paramKey] ?? PARAM_ICONS.sensors}
    </span>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export default function RobotStatusCard({ params, suggestion, style }) {
  if (!params?.length) return null

  const hasWarning = params.some(p => p.status !== 'ok')

  return (
    <Card style={style}>
      {/* ── Header ── */}
      <div className="flex justify-between items-start gap-3" style={{ marginBottom: 12 }}>
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--text-secondary)" aria-hidden>
            <path d="M12 2a2 2 0 0 1 2 2v1h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2V4a2 2 0 0 1 2-2zm0 2a.5.5 0 0 0-.5.5V7h1V4.5A.5.5 0 0 0 12 4zM9 9v2h6V9H9zm0 4v2h6v-2H9z"/>
          </svg>
          <h2 className="text-[clamp(20px,2.4vw,24px)] font-bold text-[var(--text-primary)]" style={{ margin: 0 }}>
            Parameters
          </h2>
        </div>
        {hasWarning
          ? <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[clamp(14px,1.7vw,15px)] font-semibold bg-[var(--danger-bg)] text-[var(--danger)] shrink-0">⚠ Issues detected</span>
          : <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[clamp(14px,1.7vw,15px)] font-semibold bg-[var(--success-bg)] text-[var(--success)] shrink-0">✓ All nominal</span>
        }
      </div>

      {/* ── Parameter rows ── */}
      <div className="flex flex-col gap-2.5">
        {params.map(p => {
          const s = STATUS_CLS[p.status] ?? STATUS_CLS.ok
          return (
            <div
              key={p.key}
              className={`flex items-start gap-3 px-3 py-2.5 rounded-[10px] ${s.bg}`}
            >
              <span className={`mt-0.5 ${s.text}`}>
                <ParamIcon paramKey={p.key} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[clamp(12px,1.4vw,13px)] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide leading-none mb-1">
                  {p.label}
                </div>
                <div className={`text-[clamp(14px,1.7vw,16px)] font-medium ${s.text}`}>
                  {p.value}
                </div>
              </div>
              <div className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${s.dot}`} aria-hidden />
            </div>
          )
        })}
      </div>

      {/* ── Suggestion ── */}
      {suggestion && (
        <div className="flex items-start gap-2.5 mt-3 px-3 py-2.5 rounded-[10px] bg-[var(--bg)] border-l-[3px] border-solid border-[var(--primary)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--primary)] shrink-0 mt-0.5" aria-hidden>
            <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
          </svg>
          <p className="text-[clamp(13px,1.6vw,14px)] text-[var(--text-secondary)] m-0 leading-relaxed">
            {suggestion}
          </p>
        </div>
      )}
    </Card>
  )
}
