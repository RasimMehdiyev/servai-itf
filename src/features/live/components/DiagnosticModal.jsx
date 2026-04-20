import React, { useState } from 'react'

/**
 * DiagnosticModal — the full diagnostic workspace.
 *
 * Flow:
 * 1. Camera feed image + caption/detail
 * 2. XAI validation prompt (Yes/No tied to the visual evidence)
 * 3. On validation → resolution action buttons appear dynamically
 */
export default function DiagnosticModal({ alert, validation, resolutionActions, onClose }) {
  const [validationResult, setValidationResult] = useState(null)  // null | 'confirmed' | 'false_alarm'
  const [resolved, setResolved] = useState(null)                  // null | action key string

  if (!alert) return null

  const handleValidation = (result) => {
    setValidationResult(result)
  }

  const handleResolution = (key) => {
    setResolved(key)
    // In production → POST to API. For now, just show feedback.
  }

  return (
    <div className="camera-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Diagnostic workspace">
      <div className="camera-modal camera-modal--diagnostic" onClick={e => e.stopPropagation()}>

        {/* ---- Camera image ---- */}
        <img
          className="camera-modal__img"
          src={alert.imageUrl}
          alt={alert.caption || 'Robot camera feed'}
        />

        <div className="camera-modal__body">
          <div className="camera-modal__caption">{alert.caption}</div>
          {alert.detail && <div className="camera-modal__sub">{alert.detail}</div>}

          {/* ---- Step 1: XAI Validation ---- */}
          {validation && !validationResult && (
            <div className="diag-validation mt-md">
              <p className="diag-validation__prompt">{validation.prompt}</p>
              <div className="diag-validation__btns">
                <button
                  className="quick-action-btn quick-action-btn--confirm"
                  onClick={() => handleValidation('confirmed')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5"/></svg>
                  {validation.confirmLabel}
                </button>
                <button
                  className="quick-action-btn quick-action-btn--deny"
                  onClick={() => handleValidation('false_alarm')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6L6 18M6 6l12 12"/></svg>
                  {validation.denyLabel}
                </button>
              </div>
            </div>
          )}

          {/* ---- Step 2a: Confirmed → show resolution actions ---- */}
          {validationResult === 'confirmed' && !resolved && (
            <div className="diag-resolution mt-md">
              <div className="diag-resolution__label">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5"/></svg>
                Observation confirmed — choose an action:
              </div>
              <div className="diag-resolution__btns">
                {(resolutionActions || []).map(a => (
                  <button
                    key={a.key}
                    className={`quick-action-btn quick-action-btn--${a.variant || 'outline'}`}
                    onClick={() => handleResolution(a.key)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ---- Step 2b: False alarm feedback ---- */}
          {validationResult === 'false_alarm' && !resolved && (
            <div className="action-toast action-toast--deny mt-md">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5"/></svg>
              False alarm reported — robot will reprocess sensor data
            </div>
          )}

          {/* ---- Step 3: Resolution feedback ---- */}
          {resolved && (
            <div className="action-toast action-toast--confirm mt-md">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5"/></svg>
              {resolved === 'fulfill_manually'
                ? 'Manual fulfillment initiated — robot set to idle'
                : 'Action acknowledged — robot continuing'}
            </div>
          )}

          {/* ---- Close ---- */}
          <button className="camera-modal__close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
