import React from 'react'
import Card from '../../../components/ui/Card'

export default function ChatCard({ onOpenChat }) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--teal-bg, #f0fdfa)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--teal, #0d9488)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <div className="text-[clamp(13px,1.5vw,15px)] font-medium" style={{ color: 'var(--text-primary)' }}>
              Have a question about today's operations?
            </div>
            <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
              Ask ROBI anything about orders, timing, or failures.
            </div>
          </div>
        </div>
        <button
          onClick={onOpenChat}
          className="px-4 py-2 rounded-lg text-[13px] font-semibold border-0 cursor-pointer hover:opacity-90 transition-opacity shrink-0"
          style={{ background: 'var(--teal, #14b8a6)', color: 'white' }}
        >
          Ask ROBI
        </button>
      </div>
    </Card>
  )
}
