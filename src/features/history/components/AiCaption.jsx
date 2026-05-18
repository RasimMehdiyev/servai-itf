import React from 'react'
import SmartCaption, { CaptionSkeleton } from '../../../components/ui/SmartCaption'

const TEAL = 'var(--teal, #0d9488)'
const TEAL_BG = 'var(--teal-bg, #f0fdfa)'
const AMBER = '#b45309'
const AMBER_BG = '#fffbeb'
const GRAY_400 = '#9ca3af'

/**
 * States:
 *  1. no caption, not loading     → "Generate summary" button (default on load)
 *  2. has caption, not loading     → show caption + small "Refresh" link
 *  3. loading, no caption          → skeleton
 *  4. loading, has caption         → dimmed caption + spinner
 *  5. error + has caption          → stale caption + warning + retry
 *  6. error + no caption           → apology + try again
 */
export default function AiCaption({
  caption, loading, error, stale,
  onCitationClick, onGenerate, onRefresh,
}) {
  const hasText = !!caption?.text && !caption?.cache_miss

  // Pick styling
  let borderColor = TEAL
  let bgColor = TEAL_BG
  let headerColor = TEAL
  let headerText = 'What ROBI sees'

  if (loading && hasText) {
    headerText = 'Updating summary…'
  } else if (loading && !hasText) {
    headerText = 'ROBI is thinking…'
  } else if (error && hasText) {
    headerText = 'Summary (may be slightly outdated)'
    borderColor = AMBER; bgColor = AMBER_BG; headerColor = AMBER
  } else if (error && !hasText) {
    headerText = 'Summary unavailable'
  } else if (!hasText) {
    headerText = 'AI Summary'
  }

  return (
    <div
      className="ai-caption mt-3 rounded-lg px-4 py-3"
      style={{ background: bgColor, borderLeft: `3px solid ${borderColor}` }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{
            background: headerColor,
            animation: loading ? 'pulse 2s ease-in-out infinite' : 'none',
          }}
        />
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: headerColor }}>
          {headerText}
        </span>
        {loading && hasText && (
          <svg className="animate-spin ml-auto flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: TEAL, opacity: 0.6 }}>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="50 100" />
          </svg>
        )}
      </div>

      {/* Body */}
      <div className="text-[13px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>

        {/* Generating from scratch */}
        {loading && !hasText && <CaptionSkeleton lines={3} />}

        {/* Caption text (current or stale) */}
        {hasText && (
          <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.3s' }}>
            <SmartCaption text={caption.text} onCitationClick={onCitationClick} />
          </div>
        )}

        {/* No caption, not loading — generate button */}
        {!hasText && !loading && !error && (
          <div className="flex items-center gap-3">
            <span className="text-[12px]" style={{ color: GRAY_400 }}>No summary yet.</span>
            <button
              onClick={onGenerate}
              className="px-3 py-1 rounded-lg text-[12px] font-semibold border-0 cursor-pointer hover:opacity-90"
              style={{ background: TEAL, color: 'white' }}
            >
              Generate summary
            </button>
          </div>
        )}

        {/* Error, no caption */}
        {error && !hasText && !loading && (
          <div className="flex items-center gap-3">
            <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              ROBI couldn't generate a summary — the local AI might be busy or offline.
            </span>
            <button
              onClick={onGenerate}
              className="px-2.5 py-1 rounded text-[12px] font-medium border border-solid cursor-pointer hover:opacity-80 flex-shrink-0"
              style={{ color: TEAL, borderColor: TEAL, background: 'transparent' }}
            >
              Try again
            </button>
          </div>
        )}

        {/* Stale caption warning */}
        {!loading && error && hasText && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px]" style={{ color: AMBER }}>
              Couldn't refresh — showing a previous summary.
            </span>
            <button
              onClick={onRefresh}
              className="px-2 py-0.5 rounded text-[11px] font-medium border border-solid cursor-pointer hover:opacity-80"
              style={{ color: TEAL, borderColor: TEAL, background: 'transparent' }}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Refresh link */}
      {hasText && !loading && !error && (
        <div className="mt-2 flex justify-end">
          <button
            onClick={onRefresh}
            className="text-[11px] font-medium px-2 py-0.5 rounded border border-solid cursor-pointer hover:opacity-80"
            style={{ borderColor: 'var(--border)', color: GRAY_400, background: 'transparent' }}
          >
            Refresh
          </button>
        </div>
      )}
    </div>
  )
}
