import React from 'react'
import Card from '../../../components/ui/Card'
import { useDataSource } from '../../../context/DataSourceContext'

const PILL = {
  green:  { text: 'On track',       cls: 'bg-[var(--success-bg)] text-[var(--success)]' },
  orange: { text: "Can't find it",  cls: 'bg-[var(--warning-bg)] text-[var(--warning)]' },
  red:    { text: 'Needs help',     cls: 'bg-[var(--danger-bg)] text-[var(--danger)]' },
}

export function formatDuration(ms) {
  if (!ms || ms <= 0) return '0s'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`
  return `${s}s`
}

export function formatSeconds(sec) {
  if (!sec || sec <= 0) return '0s'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`
  return `${s}s`
}

function ProgressBar({ fraction, animDuration, milestone }) {
  const pct = Math.min(Math.max(fraction * 100, 0), 100)
  const milestones = [
    { pct: 33, label: 'Started' },
    { pct: 66, label: 'Picked up' },
    { pct: 100, label: 'Handover' },
  ]

  return (
    <div className="mt-4">
      <div className="relative h-3 rounded-full bg-[var(--border)] overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--primary)] stripes"
          style={{
            width: `${pct}%`,
            transition: animDuration > 0 ? `width ${animDuration}s linear` : 'width 0.3s ease',
          }}
        />
      </div>
      <div className="flex justify-between mt-1.5">
        {milestones.map((m, i) => (
          <div key={i} className="flex flex-col items-center" style={{ width: '33.3%' }}>
            <div className={`w-2.5 h-2.5 rounded-full border-2 border-solid -mt-[11px] relative z-10 ${
              milestone >= i ? 'bg-[var(--primary)] border-[var(--primary)]' : 'bg-[var(--surface)] border-[var(--border)]'
            }`} />
            <span className="text-[10px] text-[var(--text-tertiary)] mt-1 font-medium">{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Status banner (always visible below progress) ───────────────────────────

function StatusBanner({ cardState, itemName, explanationText, onIntervene }) {
  if (cardState === 'green') {
    return (
      <div className="mt-4 flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[var(--success-bg)]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" className="shrink-0"><path d="M20 6L9 17l-5-5"/></svg>
        <span className="text-[clamp(13px,1.5vw,15px)] font-medium text-[var(--success)]">
          {explanationText || 'Everything is running fine'}
        </span>
      </div>
    )
  }

  if (cardState === 'orange') {
    return (
      <div className="mt-4">
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[var(--warning-bg)] mb-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--warning)" className="shrink-0" aria-hidden>
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
          </svg>
          <span className="text-[clamp(13px,1.5vw,15px)] font-medium text-[var(--warning)]">
            Can't find the {itemName || 'item'} on the shelf
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <button onClick={() => onIntervene?.('restock')} className="w-full px-4 py-2.5 rounded-lg font-semibold text-[15px] bg-[var(--primary)] text-white border-0 cursor-pointer hover:opacity-90 transition-opacity">
            I'll restock the shelf
          </button>
          <div className="flex gap-2">
            <button onClick={() => onIntervene?.('out_of_stock')} className="flex-1 px-3 py-2 rounded-lg text-[13px] font-medium bg-[var(--surface)] text-[var(--primary)] border border-solid border-[var(--primary)] cursor-pointer hover:bg-[var(--bg)]">
              Tell customer we're out
            </button>
            <button onClick={() => onIntervene?.('cancel')} className="flex-1 px-3 py-2 rounded-lg text-[13px] font-medium bg-[var(--danger-bg)] text-[var(--danger)] border border-solid border-[var(--danger)] cursor-pointer hover:opacity-90">
              Cancel this order
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (cardState === 'red') {
    return (
      <div className="mt-4">
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[var(--danger-bg)] mb-3">
          <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 animate-pulse-ring" style={{ color: 'var(--danger)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--danger)" aria-hidden>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 5h2v6h-2V7zm0 8h2v2h-2v-2z"/>
            </svg>
          </div>
          <span className="text-[clamp(13px,1.5vw,15px)] font-medium text-[var(--danger)]">
            {explanationText || 'I need help — please come over'}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <button onClick={() => onIntervene?.('on_my_way')} className="w-full px-4 py-2.5 rounded-lg font-semibold text-[15px] bg-[var(--primary)] text-white border-0 cursor-pointer hover:opacity-90 transition-opacity">
            I'm on my way
          </button>
          <div className="flex gap-2">
            <button onClick={() => onIntervene?.('delayed')} className="flex-1 px-3 py-2 rounded-lg text-[13px] font-medium bg-[var(--surface)] text-[var(--primary)] border border-solid border-[var(--primary)] cursor-pointer hover:bg-[var(--bg)]">
              Tell customer it's delayed
            </button>
            <button onClick={() => onIntervene?.('cancel')} className="flex-1 px-3 py-2 rounded-lg text-[13px] font-medium bg-[var(--danger-bg)] text-[var(--danger)] border border-solid border-[var(--danger)] cursor-pointer hover:opacity-90">
              Cancel this order
            </button>
          </div>
        </div>
      </div>
    )
  }

  return null
}

// ── Cycle failures log ──────────────────────────────────────────────────────

function CycleFailures({ failures }) {
  if (!failures || failures.length === 0) return null

  return (
    <div className="mt-4">
      <div className="h-px bg-[var(--border)] mb-3" />
      <div className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">Issues this cycle</div>
      <div className="flex flex-col gap-1.5">
        {failures.map((f, i) => (
          <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-lg ${
            f.level === 'red' ? 'bg-[var(--danger-bg)]' : 'bg-[var(--warning-bg)]'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-[6px] ${
              f.level === 'red' ? 'bg-[var(--danger)]' : 'bg-[var(--warning)]'
            }`} />
            <span className={`text-[clamp(12px,1.4vw,13px)] ${
              f.level === 'red' ? 'text-[var(--danger)]' : 'text-[var(--warning)]'
            }`}>
              {f.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export default function AttentionPanel({ title, level, explanationText, style }) {
  const { liveData, sendMessage } = useDataSource()
  const cardState = liveData?._cardState || 'green'
  const pill = PILL[cardState] || PILL.green
  const itemName = liveData?._itemName
  const cycleNum = liveData?._cycleNum
  const startedAt = liveData?._cycleStartedAt
  const elapsed = startedAt ? Date.now() - startedAt : 0
  const progress = liveData?.progress || { fraction: 0, milestone: 0, animDuration: 0 }
  const isActive = !!itemName && !liveData?._cycleComplete
  const failures = liveData?._cycleFailures || []

  const eta = progress.fraction > 0.05 && isActive
    ? formatDuration(Math.max(0, (elapsed / progress.fraction) - elapsed))
    : '--'

  return (
    <Card style={style}>
      {/* Header row */}
      <div className="flex justify-between items-start gap-3 mb-1">
        <div>
          <div className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-1">Now serving</div>
          <h2 className="text-[clamp(22px,2.8vw,28px)] font-bold text-[var(--text-primary)] m-0 leading-tight">
            {isActive ? itemName.charAt(0).toUpperCase() + itemName.slice(1) : 'Idle'}
          </h2>
          <div className="flex items-center gap-3 mt-1 text-[clamp(13px,1.5vw,14px)] text-[var(--text-secondary)]">
            {cycleNum && <span>Order #{cycleNum}</span>}
            {isActive && <span>· started {formatDuration(elapsed)} ago</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-semibold ${pill.cls}`}>
            <span className={`w-2 h-2 rounded-full ${cardState === 'green' ? 'bg-[var(--success)]' : cardState === 'orange' ? 'bg-[var(--warning)]' : 'bg-[var(--danger)]'} ${isActive ? 'animate-blink' : ''}`} />
            {pill.text}
          </span>
          {isActive && (
            <div className="text-right">
              <div className="text-[10px] text-[var(--text-tertiary)] uppercase font-semibold">ETA</div>
              <div className="text-[clamp(16px,2vw,20px)] font-bold text-[var(--text-primary)] tabular-nums">{eta}</div>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {isActive && (
        <ProgressBar
          fraction={progress.fraction}
          animDuration={progress.animDuration}
          milestone={progress.milestone}
        />
      )}

      {/* Real-time status banner + action buttons */}
      <StatusBanner cardState={cardState} itemName={itemName} explanationText={explanationText} onIntervene={(action) => sendMessage({ type: 'intervene', action })} />

      {/* Failures within this cycle */}
      <CycleFailures failures={failures} />
    </Card>
  )
}
