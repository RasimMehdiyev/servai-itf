import React from 'react'
import { JudgeNote } from './SmartJudge'

// Shared step list: the Live pipeline and the saved-order drawer in History use
// the same rows, so a step reads the same way while it runs and afterwards.
//
// A row is { key, title, state, summary, metrics, attempts, dur, typ, slow, why, raw, timestamp, alert, badge }
// state: done | warn | active | activeWarn | fail | pending
//   warn = finished, but needed retries or raised warnings (amber check)
// An amber step is never drawn green, and a failed step is never "Done".

const DOT = {
  done:       'bg-[var(--success)] border-[var(--success)] text-white',
  warn:       'bg-[var(--warning)] border-[var(--warning)] text-white',
  active:     'bg-[var(--primary)] border-[var(--primary)] text-white',
  activeWarn: 'bg-[var(--warning)] border-[var(--warning)] text-white',
  fail:       'bg-[var(--danger)]  border-[var(--danger)]  text-white',
  pending:    'bg-[var(--surface)] border-[var(--border)]  text-[var(--text-tertiary)]',
}

const LINE = {
  done: 'bg-[var(--success)]',
  warn: 'bg-[var(--warning)]',
  active: 'bg-[var(--primary)]',
  activeWarn: 'bg-[var(--warning)]',
  fail: 'bg-[var(--danger)]',
  pending: 'bg-[var(--border)]',
}

const BADGE = {
  done:       { text: 'Done',     cls: 'text-[var(--success-text)] bg-[var(--success-bg)]' },
  warn:       { text: 'Warnings', cls: 'text-[var(--warning-text)] bg-[var(--warning-bg)]' },
  active:     { text: 'Active',   cls: 'text-[var(--primary)]      bg-[var(--info-bg)]' },
  activeWarn: { text: 'Retrying', cls: 'text-[var(--warning-text)] bg-[var(--warning-bg)]' },
  fail:       { text: 'Failed',   cls: 'text-[var(--danger-text)]  bg-[var(--danger-bg)]' },
  pending:    { text: 'Waiting',  cls: 'text-[var(--text-secondary)] bg-[var(--border)]' },
}

const ROW_BG = {
  fail: 'bg-[#fff8f9]',
  warn: 'bg-[#fffdf2]',
  activeWarn: 'bg-[#fffdf2]',
}

const RESULT_CLS = {
  ok:   'bg-[var(--success-bg)] text-[var(--success-text)]',
  warn: 'bg-[var(--warning-bg)] text-[var(--warning-text)]',
  fail: 'bg-[var(--danger-bg)]  text-[var(--danger-text)]',
}

function Icon({ state }) {
  if (state === 'done' || state === 'warn') {
    return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M4 12l5 5 11-11" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  }
  if (state === 'fail') {
    return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
  }
  if (state === 'activeWarn') {
    return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 6v8M12 18h.01" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" /></svg>
  }
  if (state === 'active') return <span className="w-2 h-2 rounded-full bg-white" />
  return null
}

function AlertCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function Chevron({ open }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5" strokeLinecap="round"
         className="shrink-0 mt-1 transition-transform duration-200" style={{ transform: open ? 'rotate(180deg)' : 'none' }} aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function Section({ label, children }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-0.5">{label}</div>
      {children}
    </div>
  )
}

function Attempts({ attempts }) {
  return (
    <Section label="Grasp tries">
      <div className="flex flex-col gap-[3px] mt-1">
        {attempts.map(a => (
          <div key={a.n} className={`grid grid-cols-[28px_minmax(0,1.4fr)_74px_minmax(0,1fr)_72px] gap-2 items-center px-2.5 py-1 rounded-lg text-[13px] ${RESULT_CLS[a.tone]}`}>
            <span className="font-bold">{a.n}</span>
            <span className="text-[var(--text-primary)] truncate">{a.viewpoint}</span>
            <span className="tabular-nums text-[var(--text-secondary)]">refine {a.refine}</span>
            <span className="font-semibold">{a.result}</span>
            <span className="text-right tabular-nums text-[var(--text-secondary)]">{a.secs != null ? `${a.secs}s` : 'now'}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

const TRY_TONE = {
  fail:   { row: 'var(--danger-bg)',  num: 'var(--danger)',  pill: 'var(--danger-light)',  text: 'var(--danger-text)' },
  ok:     { row: 'var(--success-bg)', num: 'var(--success)', pill: 'var(--success-light)', text: 'var(--success-text)' },
  active: { row: 'var(--info-bg)',    num: 'var(--primary)', pill: '#dbeafe',              text: '#1d4ed8' },
}

// "My tries": each attempt to pick the item up, in plain words (see lib/attempts.js)
function Tries({ tries }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2.5 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">My tries</span>
        {tries.spot && <span className="text-[12px] text-[var(--text-secondary)]">The item is on the <strong className="text-[var(--text-primary)]">{tries.spot}</strong></span>}
      </div>
      <ol className="list-none m-0 mt-2 p-0 flex flex-col gap-1.5">
        {tries.rows.map(r => {
          const t = TRY_TONE[r.tone] || TRY_TONE.fail
          return (
            <li key={r.n} className="grid gap-x-2.5 items-start px-3 py-2.5 rounded-[10px]" style={{ background: t.row, gridTemplateColumns: '30px minmax(0,1fr) auto 44px' }}>
              <span className="w-6 h-6 rounded-full text-white text-[13px] font-bold flex items-center justify-center" style={{ background: t.num }}>{r.n}</span>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-[var(--text-primary)]">{r.title}</div>
                <div className="mt-0.5 text-[13px] leading-[1.4] text-[var(--text-secondary)]">{r.text}</div>
              </div>
              <span className="text-[12px] font-semibold px-2 py-[3px] rounded-full whitespace-nowrap" style={{ background: t.pill, color: t.text }}>{r.label}</span>
              <span className="text-right text-[13px] font-semibold text-[var(--text-secondary)] tabular-nums">{r.secs != null ? `${r.secs}s` : ''}</span>
            </li>
          )
        })}
      </ol>
      {tries.footer.map(f => <div key={f} className="mt-2 text-[12.5px] leading-[1.4] text-[var(--text-secondary)]">{f}</div>)}
    </div>
  )
}

export function StepRow({ step, isLast, open, onToggle, onOpenDiagnostic }) {
  const { state } = step
  const badge = BADGE[state] || BADGE.pending
  const hasMore = !!(step.why || step.raw?.length || step.attempts || step.tries)

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center w-6 shrink-0">
        <div className={`w-6 h-6 rounded-full border-2 border-solid flex items-center justify-center shrink-0 z-10 mt-[10px] ${DOT[state] || DOT.pending} ${state === 'active' ? 'step-halo' : state === 'activeWarn' ? 'step-halo step-halo-warn' : ''}`}>
          <Icon state={state} />
        </div>
        {!isLast && <div className={`w-0.5 flex-1 min-h-[16px] mt-1 ${LINE[state] || LINE.pending}`} />}
      </div>

      <div className={`flex-1 min-w-0 mb-1 rounded-xl ${open ? (ROW_BG[state] || 'bg-[var(--bg)]') : ''}`}>
        <button
          type="button"
          aria-expanded={hasMore ? open : undefined}
          onClick={hasMore ? onToggle : undefined}
          className={`w-full text-left bg-transparent border-0 px-3 py-2.5 rounded-xl grid grid-cols-[minmax(0,1fr)_auto_16px] gap-3 items-start ${hasMore ? 'cursor-pointer hover:bg-[var(--bg)]' : 'cursor-default'}`}
        >
          <span className="min-w-0">
            <span className="flex items-center flex-wrap gap-x-2 gap-y-1">
              <span className="font-semibold text-[clamp(15px,2.0vw,17px)] leading-snug text-[var(--text-primary)]">{step.title}</span>
              <span className={`inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${badge.cls}`}>{step.badge || badge.text}</span>
            </span>
            {step.summary && (
              <span className="block mt-0.5 text-[clamp(13px,1.5vw,14px)] leading-snug text-[var(--text-secondary)]">{step.summary}</span>
            )}
            <JudgeNote note={step.judge} />
            {step.metrics?.length > 0 && (
              <span className="flex flex-wrap gap-1.5 mt-2">
                {step.metrics.map(m => (
                  <span key={m.k} className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-[#f3f4f6] text-[12px] text-[var(--text-secondary)]">
                    {m.k} <strong className="text-[var(--text-primary)] tabular-nums">{m.v}</strong>
                  </span>
                ))}
              </span>
            )}
          </span>
          <span className="text-right shrink-0 min-w-[96px]">
            {(step.dur || step.timestamp) && (
              <span className={`block text-[14px] font-semibold tabular-nums ${step.slow ? 'text-[var(--warning-text)]' : 'text-[var(--text-primary)]'}`}>
                {step.dur || step.timestamp}
              </span>
            )}
            {step.typ && <span className="block text-[11px] text-[var(--text-secondary)]">{step.typ}</span>}
          </span>
          {hasMore ? <Chevron open={open} /> : <span />}
        </button>

        {step.alert && (
          <div className="px-3 pb-3">
            <button className="btn btn-sm btn-error gap-1.5" onClick={() => onOpenDiagnostic?.()}>
              <AlertCircleIcon />
              View Camera Feed
            </button>
          </div>
        )}

        {open && hasMore && (
          <div className="px-3 pb-3.5 flex flex-col gap-2.5">
            {step.why && (
              <Section label="Why">
                <div className="text-[14px] leading-relaxed text-[var(--text-primary)]">{step.why}</div>
              </Section>
            )}
            {step.tries && <Tries tries={step.tries} />}
            {step.attempts && <Attempts attempts={step.attempts} />}
            {step.raw?.length > 0 && (
              <Section label="Raw log">
                <div className="px-2.5 py-1.5 rounded-lg bg-[var(--bg)] text-[12px] leading-relaxed text-[var(--text-secondary)] font-mono break-words">
                  {step.raw.slice(-4).map((l, i) => <div key={i}>{l}</div>)}
                </div>
              </Section>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

export function PendingRow({ title, isLast }) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center w-6 shrink-0">
        <div className="w-6 h-6 rounded-full border-2 border-solid border-[var(--border)] bg-[var(--surface)] shrink-0 mt-[6px]" />
        {!isLast && <div className="w-0.5 flex-1 min-h-[10px] mt-1 bg-[var(--border)]" />}
      </div>
      <div className="flex-1 min-w-0 px-3 py-2 text-[14px] text-[var(--text-secondary)]">{title}</div>
    </li>
  )
}

/**
 * The step list. `isOpen(row)` and `onToggle(row)` let the caller own the open/closed state.
 * Steps not reached after a failure collapse into one line.
 */
export default function StepList({ rows, isOpen, onToggle, onOpenDiagnostic }) {
  const reached = rows.filter(r => r.state !== 'pending')
  const pending = rows.filter(r => r.state === 'pending')
  const failedCycle = rows.some(r => r.state === 'fail')
  const collapsePending = failedCycle && pending.length > 2
  return (
    <ul className="list-none m-0 p-0">
      {reached.map((r, i) => (
        <StepRow
          key={r.key}
          step={r}
          isLast={i === reached.length - 1 && pending.length === 0}
          open={isOpen(r)}
          onToggle={() => onToggle(r)}
          onOpenDiagnostic={onOpenDiagnostic}
        />
      ))}
      {collapsePending ? (
        <PendingRow isLast title={`Not reached: ${pending.map(p => p.title.toLowerCase()).join(', ')}`} />
      ) : (
        pending.map((p, i) => <PendingRow key={p.key} title={p.title} isLast={i === pending.length - 1} />)
      )}
    </ul>
  )
}
