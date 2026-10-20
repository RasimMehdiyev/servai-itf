import React, { useState } from 'react'
import Card from '../../../components/ui/Card'
import { useDataSource } from '../../../context/DataSourceContext'
import { clock } from '../../../lib/logTranslate'
import { deriveLog } from '../../../lib/liveView'

const STATUS_CLS = {
  ok:      { dot: 'bg-[var(--success)]', text: 'text-[var(--success-text)]', bg: 'bg-[var(--success-bg)]' },
  warning: { dot: 'bg-[var(--warning)]', text: 'text-[var(--warning-text)]', bg: 'bg-[var(--warning-bg)]' },
}

const TONE_DOT = {
  ok: 'bg-[var(--success)]',
  warn: 'bg-[var(--warning)]',
  fail: 'bg-[var(--danger)]',
}

const PARAM_LABELS = { arm: 'ARM', gripper: 'GRIPPER', planner: 'PLANNER', speed: 'SPEED' }

export default function TechnicalDetails({ params, suggestion }) {
  const { liveData } = useDataSource()
  const log = deriveLog(liveData, 6)
  // Open by default when something needs a technician's eye
  const trouble = liveData?._cardState === 'orange' || liveData?._cardState === 'red'
  const [override, setOverride] = useState(null)
  const open = override === null ? trouble : override

  if (!params?.length && log.length === 0) return null

  return (
    <Card>
      <button
        className="flex items-center justify-between w-full bg-transparent border-0 cursor-pointer p-0 text-left"
        onClick={() => setOverride(!open)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--text-tertiary)" aria-hidden>
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81a.47.47 0 00-.47-.41h-3.85c-.24 0-.44.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.03.24.24.41.47.41h3.85c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/>
          </svg>
          <span className="text-[clamp(14px,1.6vw,16px)] font-semibold text-[var(--text-secondary)]">
            Technical details
          </span>
          <span className="text-[clamp(12px,1.3vw,13px)] text-[var(--text-secondary)]">(for technicians)</span>
        </div>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="var(--text-tertiary)" strokeWidth="2.5" strokeLinecap="round"
          className="shrink-0 transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-4 animate-fadeIn">
          {params?.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {params.map(p => {
                const s = STATUS_CLS[p.status] || STATUS_CLS.ok
                return (
                  <div key={p.key} className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] ${s.bg}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
                        {PARAM_LABELS[p.key] || p.label}
                      </div>
                      <div className={`text-[clamp(13px,1.5vw,14px)] font-medium ${s.text}`}>{p.value}</div>
                    </div>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${s.dot} ${p.status === 'ok' ? 'animate-blink' : ''}`} />
                  </div>
                )
              })}
            </div>
          )}

          {suggestion && (
            <div className="px-3 py-2.5 rounded-[10px] bg-[var(--bg)] border-l-[3px] border-solid border-[var(--primary)]">
              <p className="text-[clamp(12px,1.4vw,13px)] text-[var(--text-secondary)] m-0">{suggestion}</p>
            </div>
          )}

          {log.length > 0 && (
            <div>
              <div className="hidden md:grid grid-cols-[76px_minmax(0,1fr)_minmax(0,1fr)] gap-4 pb-1.5 border-b border-solid border-[var(--border)] text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                <span>Time</span>
                <span>Robot log</span>
                <span>In plain words</span>
              </div>
              {log.map((l, i) => (
                <div key={`${l.ts}-${i}`} className="grid md:grid-cols-[76px_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-1 items-start py-2.5 border-b border-solid border-[#f3f4f6]">
                  <span className="flex items-center gap-1.5 text-[12px] font-mono tabular-nums text-[var(--text-secondary)]">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[l.tone] || TONE_DOT.ok}`} />
                    {clock(l.ts)}
                  </span>
                  <span className="text-[12px] leading-relaxed font-mono text-[var(--text-secondary)] break-words">{l.raw}</span>
                  <span className="text-[clamp(13px,1.5vw,14px)] leading-snug text-[var(--text-primary)]">{l.plain}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
