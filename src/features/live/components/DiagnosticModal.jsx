import React, { useState } from 'react'

// ── Action button variant → Tailwind classes ───────────────────────────────

const VARIANT_CLS = {
  primary: 'bg-[var(--primary)] text-white border-solid border-[var(--primary)] hover:shadow-[0_2px_8px_rgba(43,127,255,.3)]',
  outline: 'bg-[var(--surface)] text-[var(--text-primary)] border-solid border-[var(--border)] hover:bg-[var(--bg)]',
  danger:  'bg-[var(--danger-bg)] text-[var(--danger)] border-solid border-[var(--danger)] hover:shadow-[0_2px_8px_rgba(240,87,100,.2)]',
  confirm: 'bg-[var(--success-bg)] text-[var(--success)] border-solid border-[var(--success)] hover:shadow-[0_2px_8px_rgba(16,185,129,.2)]',
  deny:    'bg-[var(--surface)] text-[var(--text-secondary)] border-solid border-[var(--border)] hover:bg-[var(--bg)]',
}

const actionBtn = (variant = 'outline') =>
  `inline-flex items-center gap-1.5 px-4 py-2.5 rounded-[6px] font-semibold text-[clamp(16px,2.0vw,17px)] min-h-[44px] border cursor-pointer transition-shadow ${VARIANT_CLS[variant] ?? VARIANT_CLS.outline}`

// ── Icons ──────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6L9 17l-5-5"/>
    </svg>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export default function DiagnosticModal({ alert, validation, resolutionActions, onClose }) {
  const [step, setStep] = useState('validate') // 'validate' | 'resolve' | 'false_alarm' | 'resolved'
  const [resolved, setResolved] = useState(null)

  if (!alert) return null

  return (
    <div
      className="fixed inset-0 z-[100] bg-[rgba(15,23,42,0.55)] backdrop-blur-sm flex items-center justify-center p-4"
      style={{ animation: 'fadeIn .2s ease' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Camera diagnostic"
    >
      {/* ── Card ── */}
      <div
        className="bg-[var(--surface)] rounded-[18px] overflow-hidden max-w-[520px] w-full shadow-[0_8px_32px_rgba(15,23,42,0.18)] max-h-[calc(100vh-48px)] flex flex-col"
        style={{ animation: 'slideUp .25s ease' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Top bar with X ── */}
        <div className="flex items-center justify-end px-3 pt-3 pb-0">
          <button
            className="w-8 h-8 flex items-center justify-center rounded-full bg-[var(--bg)] text-[var(--text-secondary)] border border-solid border-[var(--border)] cursor-pointer transition-colors hover:bg-[var(--border)] hover:text-[var(--text-primary)]"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* ── Figure ── */}
        <div className="overflow-hidden flex items-center justify-center" style={{ aspectRatio: '16/10', background: '#fff' }}>
          <img
            className="w-[90%] h-[90%] object-cover block transition-transform duration-500 hover:scale-105"
            src={alert.imageUrl}
            alt="Robot camera feed"
          />
        </div>

        {/* ── Card body ── */}
        <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-3">

          {/* Title: validation prompt rephrased as a positive question, or plain caption */}
          <h5 className="text-[clamp(17px,2.1vw,19px)] font-bold text-[var(--text-primary)] leading-snug m-0 text-justify ">
            {validation?.prompt ?? alert.caption}
          </h5>

          {/* Detail */}
          {alert.detail && (
            <p className="text-[clamp(14px,1.7vw,16px)] text-[var(--text-secondary)] m-0 leading-relaxed text-justify">
              {alert.detail}
            </p>
          )}

          {/* ── Step: validate ── */}
          {step === 'validate' && validation && (
            <div className="flex flex-wrap justify-between mt-1">
              {/* Deny first (positive framing: "looks different") */}
              <button
                className={actionBtn('deny')}
                onClick={() => setStep('false_alarm')}
              >
                {validation.denyLabel}
              </button>
              {/* Confirm second */}
              <button
                className={actionBtn('confirm')}
                onClick={() => setStep('resolve')}
              >
                <CheckIcon />
                {validation.confirmLabel}
              </button>
            </div>
          )}

          {/* ── Step: resolve ── */}
          {step === 'resolve' && (
            <div className="flex flex-col gap-2.5 mt-1">
              <p className="text-[clamp(15px,1.7vw,16px)] font-semibold text-[var(--text-primary)] m-0">
                Observation confirmed — choose how to proceed:
              </p>
              <div className="flex flex-wrap gap-2">
                {(resolutionActions || []).map(a => (
                  <button
                    key={a.key}
                    className={actionBtn(a.variant || 'outline')}
                    onClick={() => { setResolved(a.key); setStep('resolved') }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Step: false alarm ── */}
          {step === 'false_alarm' && (
            <div className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] text-[clamp(15px,1.7vw,16px)] font-medium bg-[var(--success-bg)] text-[var(--success)]">
              <CheckIcon />
              Sensor data queued for review — I will retry with updated information
            </div>
          )}

          {/* ── Step: resolved ── */}
          {step === 'resolved' && (
            <div className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] text-[clamp(15px,1.7vw,16px)] font-medium bg-[var(--success-bg)] text-[var(--success)]">
              <CheckIcon />
              {resolved === 'fulfill_manually'
                ? 'Manual fulfillment initiated — I am standing by'
                : 'Action acknowledged — I am continuing with the order'}
            </div>
          )}


        </div>
      </div>
    </div>
  )
}