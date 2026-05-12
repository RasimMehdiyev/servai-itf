import React from 'react'
import Card from '../../../components/ui/Card'
import SmartCaption, { CaptionSkeleton } from '../../../components/ui/SmartCaption'
import useRagCaption from '../../../hooks/useRagCaption'

export default function WeeklySummaryCard({ onCitationClick }) {
  const { caption, loading, refresh } = useRagCaption('weekly')

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--teal, #14b8a6)' }} />
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--teal, #0d9488)' }}>
            ROBI's weekly report
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-[11px] font-medium px-2 py-1 rounded border border-solid cursor-pointer hover:bg-[var(--bg)] disabled:opacity-50"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--surface)' }}
        >
          {loading ? 'Updating…' : 'Refresh'}
        </button>
      </div>

      <div className="text-[clamp(13px,1.5vw,15px)] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
        {loading ? (
          <CaptionSkeleton lines={4} />
        ) : caption?._offline ? (
          <span className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>ROBI's report is unavailable right now — local AI is offline.</span>
        ) : caption?.text ? (
          <SmartCaption text={caption.text} onCitationClick={onCitationClick} />
        ) : (
          <span style={{ color: 'var(--text-tertiary)' }}>No summary available yet.</span>
        )}
      </div>
    </Card>
  )
}
