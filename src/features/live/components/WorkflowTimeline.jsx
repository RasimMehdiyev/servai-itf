import React, { useState } from 'react'
import Card from '../../../components/ui/Card'
import DiagnosticModal from './DiagnosticModal'

const dotClass = (state) => {
  const map = { completed: '--completed', warning: '--warning', active: '--active', pending: '--pending', failed: '--danger' }
  return `timeline-step__dot timeline-step__dot${map[state] || '--pending'}`
}

const stepClass = (state) => {
  const map = { completed: '--completed', warning: '--warning', active: '--active', pending: '--pending' }
  return `timeline-step timeline-step${map[state] || '--pending'}`
}

/* Green circled-check icon for completed steps */
function CheckIcon() {
  return (
    <span className="timeline-step__status-icon timeline-step__status-icon--check">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="2" />
        <path d="M7 12.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

export default function WorkflowTimeline({ title, earlierStepsCount, steps, validation, resolutionActions, diagnosticOpen, onOpenDiagnostic, onCloseDiagnostic }) {
  const [expanded, setExpanded] = useState(false)

  const visibleSteps = expanded ? steps : steps.slice(earlierStepsCount)

  // Find the alert data from the first step that has one
  const alertStep = steps.find(s => s.alert)
  const alertData = alertStep?.alert || null

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="gap-row">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--text-secondary)" aria-hidden><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" fill="none" stroke="var(--text-secondary)" strokeWidth="2"/></svg>
          <h2 style={{ fontSize: 'clamp(15px,2vw,17px)', fontWeight: 600 }}>{title}</h2>
        </div>
        <button
          className="expand-toggle"
          aria-expanded={expanded}
          aria-controls="wf-timeline"
          onClick={() => setExpanded(v => !v)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {!expanded && earlierStepsCount > 0 && (
        <button className="expand-toggle mt-sm" onClick={() => setExpanded(true)} style={{ width: '100%', justifyContent: 'center' }}>
          <span>{earlierStepsCount} earlier steps</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      )}

      <div id="wf-timeline" className="timeline mt-sm">
        {visibleSteps.map(step => (
          <div key={step.id} className={stepClass(step.state)}>
            <div className={dotClass(step.state)} />
            <div className="timeline-step__body">
              <div style={{ flex: 1 }}>
                <div className="timeline-step__title">{step.title}</div>
                <div className="timeline-step__desc">{step.description}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                <span className="timeline-step__time">{step.timestamp}</span>
                {step.state === 'completed' && <CheckIcon />}
                {step.alert && (
                  <button
                    className="alert-badge"
                    onClick={() => onOpenDiagnostic?.()}
                    aria-label={`View alert: ${step.alert.caption}`}
                    title="View robot camera"
                  >
                    {step.badgeLabel || '!'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

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
