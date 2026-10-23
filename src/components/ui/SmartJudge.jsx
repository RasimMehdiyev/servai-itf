import React from 'react'
import { JUDGE_NAME } from '../../lib/critic'

// Everything the AI Judge says is drawn the same way, so it can never be mistaken for the
// robot talking about itself: violet (a colour nothing else on the dashboard uses), an eye, and
// the name "AI Judge" on a label that sits on the frame like a detection label on a camera image.

export function EyeIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** The small "👁 AI Judge" label used on rows, log lines and chips. */
export function JudgeTag({ label = JUDGE_NAME, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 h-[18px] px-1.5 rounded-md text-[10.5px] font-bold uppercase tracking-wide bg-[var(--judge)] text-white whitespace-nowrap ${className}`}>
      <EyeIcon size={11} />
      {label}
    </span>
  )
}

const NOTE_TONE = {
  ok:    'border-[var(--judge-border)] bg-[var(--judge-bg)]',
  info:  'border-[var(--judge-border)] bg-[var(--judge-bg)]',
  warn:  'border-[var(--warning)] bg-[var(--warning-bg)]',
  alert: 'border-[var(--danger)] bg-[var(--danger-bg)]',
}

/** One line under a step: what the judge said about it. */
export function JudgeNote({ note }) {
  if (!note) return null
  return (
    <span className={`mt-1.5 flex items-start gap-2 rounded-lg border border-solid px-2 py-1.5 ${NOTE_TONE[note.tone] || NOTE_TONE.info}`}>
      <JudgeTag className="mt-px shrink-0" />
      <span className="text-[13px] leading-snug text-[var(--text-primary)]">{note.text}</span>
    </span>
  )
}

const TONE = {
  ok:    { ring: 'var(--judge)', pill: 'bg-[var(--judge-bg)] text-[var(--judge-text)]' },
  info:  { ring: 'var(--judge)', pill: 'bg-[var(--judge-bg)] text-[var(--judge-text)]' },
  warn:  { ring: 'var(--warning)', pill: 'bg-[var(--warning-bg)] text-[var(--warning-text)]' },
  alert: { ring: 'var(--danger)', pill: 'bg-[var(--danger-bg)] text-[var(--danger-text)]' },
}

/**
 * The AI Judge's box: who is speaking, what it looks at, what it says and the numbers behind it.
 * `view` comes from lib/critic.js (criticView for the live order, orderCriticView for a saved one).
 */
export default function SmartJudgeBox({ view, compact = false }) {
  if (!view) return null
  const t = TONE[view.tone] || TONE.info
  const thinking = view.mode === 'thinking'
  // "Thinking" and plain "watching" lines get a slim box (no numbers, no small print)
  const slim = thinking || view.mode === 'watching'
  return (
    <section
      aria-label={`${JUDGE_NAME} says`}
      className="relative mt-5 mb-1 rounded-xl border-2 border-solid px-3.5 pb-3.5 pt-5"
      style={{ borderColor: t.ring, background: 'var(--judge-bg)' }}
    >
      {/* the label sits on the frame, like a detection label on a camera image */}
      <span className="absolute -top-[11px] left-3 inline-flex items-center gap-1.5 h-[22px] px-2 rounded-md text-[11px] font-bold uppercase tracking-wider text-white" style={{ background: t.ring }}>
        <EyeIcon size={13} />
        {JUDGE_NAME}
      </span>
      {!thinking && (
        <span className={`absolute -top-[11px] right-3 inline-flex items-center h-[22px] px-2 rounded-md text-[11px] font-semibold border border-solid ${t.pill}`} style={{ borderColor: t.ring }}>
          {view.title}
        </span>
      )}

      <div>
        <div className="min-w-0">
          <p className="m-0 text-[clamp(14px,1.7vw,16px)] leading-snug font-medium text-[var(--text-primary)]">
            {view.line}
            {thinking && (
              <span aria-hidden className="inline-flex gap-0.5 ml-1 align-middle">
                {[0, 1, 2].map(i => <span key={i} className="w-1 h-1 rounded-full animate-pulse" style={{ background: 'var(--judge)', animationDelay: `${i * 200}ms` }} />)}
              </span>
            )}
          </p>
          {view.facts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {view.facts.map(f => (
                <span key={f.k} className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-[var(--surface)] border border-solid border-[var(--judge-border)] text-[12px] text-[var(--text-secondary)]">
                  {f.k} <strong className="text-[var(--text-primary)] tabular-nums">{f.v}</strong>
                </span>
              ))}
            </div>
          )}
          {!compact && !slim && (
            <p className="m-0 mt-2 text-[11.5px] leading-snug text-[var(--text-secondary)]">
              Not the robot: an independent camera and AI model that watches from the side. It only judges; it never moves the robot.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
