import React from 'react'
import SmartCaption, { CaptionSkeleton } from '../../../components/ui/SmartCaption'

export default function AiCaption({ caption, loading, error, onCitationClick }) {
  const isOffline = caption?._offline || (error && !caption?.text)

  return (
    <div
      className="ai-caption mt-3 rounded-lg px-4 py-3"
      style={{
        background: 'var(--teal-bg, #f0fdfa)',
        borderLeft: '3px solid var(--teal, #0d9488)',
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="w-2 h-2 rounded-full"
          style={{
            background: 'var(--teal, #0d9488)',
            animation: loading ? 'pulse 2s ease-in-out infinite' : 'none',
          }}
        />
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--teal, #0d9488)' }}
        >
          {isOffline ? 'AI offline' : loading ? 'ROBI is thinking…' : "What ROBI sees"}
        </span>
      </div>

      <div className="text-[13px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
        {loading ? (
          <CaptionSkeleton lines={3} />
        ) : caption?.text && !isOffline ? (
          <SmartCaption text={caption.text} onCitationClick={onCitationClick} />
        ) : isOffline ? (
          <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            ROBI's report is unavailable right now — local AI is offline.
          </span>
        ) : (
          <span style={{ color: 'var(--text-tertiary)' }}>No AI caption available.</span>
        )}
      </div>
    </div>
  )
}
