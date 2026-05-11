import React, { useState, useEffect, useRef } from 'react'
import Card from '../../../components/ui/Card'
import DiagnosticModal from './DiagnosticModal'

const INITIAL_COUNT = 4
const LOAD_BATCH    = 3   // extra rows revealed per scroll trigger

// ── Per-state Tailwind classes ───────────────────────────────────────────────
// CSS-variable arbitrary values + explicit border-solid (preflight disabled)

const DOT_CLS = {
  completed: 'bg-[var(--success)] border-solid border-[var(--success)] text-white',
  warning:   'bg-[var(--danger)]  border-solid border-[var(--danger)]  text-white',
  failed:    'bg-[var(--danger)]  border-solid border-[var(--danger)]  text-white',
  active:    'bg-[var(--primary)] border-solid border-[var(--primary)] text-white',
  loading:   'bg-[var(--surface)] border-solid border-[var(--border)] text-[var(--text-tertiary)]',
  pending:   'bg-[var(--surface)] border-[var(--text-tertiary)] text-[var(--text-tertiary)]',
}

const LINE_CLS = {
  completed: 'bg-[var(--success)]',
  warning:   'bg-[var(--danger)]',
  failed:    'bg-[var(--danger)]',
  active:    'bg-[var(--primary)]',
  loading:   'bg-[var(--border)]',
  pending:   'bg-[var(--border)]',
}

const CARD_CLS = {
  completed: 'bg-[var(--success-bg)]',
  warning:   'bg-[var(--danger-bg)]',
  failed:    'bg-[var(--danger-bg)]',
  active:    'bg-[var(--info-bg)]',
  loading:   'bg-[var(--surface)] border-l-[3px] border-solid border-[var(--border)]',
  pending:   'bg-[var(--surface)] border-l-[3px] border-solid border-[var(--border)]',
}

const DESC_CLS = {
  completed: 'text-[var(--text-secondary)]',
  warning:   'text-[var(--danger)]',
  failed:    'text-[var(--danger)]',
  active:    'text-[var(--text-secondary)]',
  loading:   'text-[var(--text-tertiary)]',
  pending:   'text-[var(--text-tertiary)]',
}

const STATE_BADGE = {
  completed: { text: 'Done',     cls: 'text-[var(--success)]       bg-[var(--success-bg)]' },
  warning:   { text: 'Failed',   cls: 'text-[var(--danger)]        bg-[var(--danger-bg)]'  },
  failed:    { text: 'Failed',   cls: 'text-[var(--danger)]        bg-[var(--danger-bg)]'  },
  active:    { text: 'Active',   cls: 'text-[var(--primary)]       bg-[var(--info-bg)]'    },
  loading:   { text: 'Next',     cls: 'text-[var(--text-tertiary)] bg-[var(--border)]'     },
  pending:   { text: 'Upcoming', cls: 'text-[var(--text-secondary)] bg-[var(--border)]'    },
}

// ── Icons ────────────────────────────────────────────────────────────────────

function SmallCheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 12l5 5 11-11" stroke="currentColor" strokeWidth="3.5"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AlertCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

// ── Separator between upcoming and past steps ────────────────────────────────

function SectionDivider() {
  return (
    <li className="flex items-center gap-3 my-2 select-none" aria-hidden>
      <div className="flex flex-col items-center w-7 shrink-0">
        {/* empty dot column space so text aligns with cards */}
      </div>
      <div className="flex items-center gap-2 flex-1">
        <div className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-[11px] font-semibold tracking-wide uppercase text-[var(--text-tertiary)] whitespace-nowrap">
          Upcoming steps
        </span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>
    </li>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export default function WorkflowTimeline({
  title,
  earlierStepsCount, // kept for API compatibility
  steps,
  validation,
  resolutionActions,
  diagnosticOpen,
  onOpenDiagnostic,
  onCloseDiagnostic,
}) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_COUNT)
  const [showUpcoming, setShowUpcoming] = useState(false)
  const sentinelRef = useRef(null)

  const upcoming = steps.filter(s => s.state === 'pending')
  const happened = steps.filter(s => s.state !== 'pending').reverse()

  // Base list is always most-recent-first past steps; upcoming injected at top on demand
  const ordered = showUpcoming ? [...upcoming, ...happened] : happened

  const hasMore = visibleCount < ordered.length
  const visible = ordered.slice(0, visibleCount)

  // Scroll-based lazy loading via IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount(c => Math.min(c + LOAD_BATCH, ordered.length))
        }
      },
      { threshold: 0.1 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, ordered.length])

  // Reset on scenario change
  useEffect(() => {
    setVisibleCount(INITIAL_COUNT)
    setShowUpcoming(false)
  }, [steps])

  const alertData = steps.find(s => s.alert)?.alert ?? null

  // Track where the upcoming block ends inside visible (for separator)
  const upcomingInView = showUpcoming ? visible.filter(s => s.state === 'pending').length : 0
  const happenedInView = visible.filter(s => s.state !== 'pending').length
  const showSeparator  = upcomingInView > 0 && happenedInView > 0

  return (
    <Card>
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"
               className="text-[var(--text-secondary)] shrink-0" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
          <h2 className="text-[clamp(18px,2.4vw,21px)] font-semibold text-[var(--text-primary)]">
            {title}
          </h2>
        </div>
        {upcoming.length > 0 && (
          <button
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold border border-solid cursor-pointer transition-colors ${
              showUpcoming
                ? 'bg-[var(--border)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg)]'
                : 'bg-[var(--surface)] text-[var(--text-tertiary)] border-[var(--border)] hover:bg-[var(--border)]'
            }`}
            onClick={() => setShowUpcoming(v => !v)}
            aria-pressed={showUpcoming}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="3 2" aria-hidden>
              <circle cx="12" cy="12" r="10" />
            </svg>
            {showUpcoming ? 'Hide upcoming' : `${upcoming.length} upcoming`}
          </button>
        )}
      </div>

      {/* ── Timeline list ── */}
      <ul className="list-none m-0 p-0">
        {visible.map((step, i) => {
          const isLastInBlock = i === upcomingInView - 1  // last upcoming before separator
          const isLast        = i === visible.length - 1 && !hasMore
          const dotCls  = DOT_CLS[step.state]  ?? DOT_CLS.pending
          const lineCls = LINE_CLS[step.state] ?? LINE_CLS.pending
          const cardCls = CARD_CLS[step.state] ?? CARD_CLS.pending
          const descCls = DESC_CLS[step.state] ?? DESC_CLS.pending
          const badge   = STATE_BADGE[step.state] ?? STATE_BADGE.pending
          // Suppress connector on the last upcoming step (separator takes over visually)
          const showConnector = !isLast && !(showSeparator && isLastInBlock)

          return (
            <React.Fragment key={step.id}>
              <li className="flex">
                {/* ── Dot + connector column ── */}
                <div className="flex flex-col items-center w-7 shrink-0">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 z-10 mt-[14px] ${dotCls} ${step.state === 'pending' ? 'border-dashed' : 'border-solid'} ${step.state === 'active' ? 'animate-pulse-ring' : ''} ${step.state === 'loading' ? 'animate-blink' : ''}`}>
                    {step.state === 'completed' && <SmallCheckIcon />}
                  </div>
                  {showConnector && (
                    <div className={`w-0.5 flex-1 min-h-[16px] mt-0.5 ${lineCls}`} />
                  )}
                </div>

                {/* ── Card ── */}
                <div className={`flex-1 ml-2 mb-3 rounded-[10px] px-4 py-3 ${cardCls}`}>
                  {step.state === 'loading' ? (
                    /* Skeleton placeholder for the next expected step */
                    <div className="animate-pulse">
                      <div className="flex items-start justify-between gap-3 mb-1.5">
                        <div className="h-5 w-2/3 rounded bg-[var(--border)]" />
                        <div className="h-4 w-10 rounded bg-[var(--border)]" />
                      </div>
                      <div className="h-4 w-4/5 rounded bg-[var(--border)] mt-2" />
                      <div className="mt-2">
                        <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
                          {badge.text}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3 mb-1.5">
                        <div className="font-semibold text-[clamp(16px,2.0vw,18px)] text-[var(--text-primary)] leading-snug">
                          {step.title}
                        </div>
                        <span className="text-[clamp(13px,1.5vw,14px)] text-[var(--text-tertiary)] whitespace-nowrap shrink-0 pt-0.5 font-medium tabular-nums">
                          {step.timestamp}
                        </span>
                      </div>

                      <div className={`text-[clamp(14px,1.6vw,15px)] m-0 leading-snug ${descCls}`}>
                        {step.debugMessages?.length > 0 ? (
                          step.debugMessages.map((msg, di) => (
                            <p key={di} className="flex items-start gap-1.5 m-0 mt-1 text-[clamp(11px,1.3vw,12px)] text-[var(--text-tertiary)]">
                              <span className="shrink-0 mt-[4px] w-1.5 h-1.5 rounded-full bg-[var(--warning)]" />
                              <span className="font-mono">{msg}</span>
                            </p>
                          ))
                        ) : (
                          <p className="m-0">{step.description}</p>
                        )}
                      </div>

                      {step.alert && (
                        <div className="mt-2.5">
                          <button
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[clamp(14px,1.6vw,15px)] font-medium bg-[var(--danger)] text-white border-0 cursor-pointer transition-shadow hover:shadow-[0_2px_8px_rgba(240,87,100,.35)]"
                            onClick={() => onOpenDiagnostic?.()}
                          >
                            <AlertCircleIcon />
                            View Camera Feed
                          </button>
                        </div>
                      )}

                      <div className="mt-2">
                        <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
                          {badge.text}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </li>

              {/* Insert divider after the last upcoming step */}
              {showSeparator && isLastInBlock && (
                <SectionDivider />
              )}
            </React.Fragment>
          )
        })}

        {/* Sentinel — triggers loading more when scrolled into view */}
        {hasMore && (
          <li ref={sentinelRef} className="flex items-center justify-center py-3" aria-hidden>
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--border)] animate-pulse" />
          </li>
        )}
      </ul>

      {/* ── Diagnostic modal ── */}
      {diagnosticOpen && alertData && (
        <DiagnosticModal
          alert={alertData}
          validation={validation}
          resolutionActions={resolutionActions}
          onClose={onCloseDiagnostic}
        />
      )}
    </Card>
  )
}

