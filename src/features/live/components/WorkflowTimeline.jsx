import React, { useState } from 'react'
import Card from '../../../components/ui/Card'
import StepList from '../../../components/ui/StepList'
import DiagnosticModal from './DiagnosticModal'
import { useDataSource } from '../../../context/DataSourceContext'
import useNow from '../../../hooks/useNow'
import { deriveSteps } from '../../../lib/liveView'

// The pipeline, oldest step first. Each step shows how long it took against how
// long it usually takes, the numbers behind it, and — on tap — why it did what it
// did, the grasp tries, and the raw log lines. The rows are shared with the saved
// order drawer in History (components/ui/StepList.jsx).

export default function WorkflowTimeline({
  title,
  steps,
  validation,
  resolutionActions,
  diagnosticOpen,
  onOpenDiagnostic,
  onCloseDiagnostic,
}) {
  const { liveData, history } = useDataSource()
  const running = !!liveData && !liveData._cycleComplete
  const now = useNow(running)
  const [overrides, setOverrides] = useState({})

  const rows = deriveSteps(liveData || { steps }, history, now)
  const cycleKey = liveData?._cycleNum ?? 'mock'
  const alertData = steps?.find(s => s.alert)?.alert ?? null

  const isOpen = (r) => {
    const k = `${cycleKey}:${r.key}`
    return overrides[k] === undefined ? !!r.openDefault : overrides[k]
  }
  const toggle = (r) => {
    const k = `${cycleKey}:${r.key}`
    setOverrides(o => ({ ...o, [k]: !(o[k] === undefined ? !!r.openDefault : o[k]) }))
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"
               className="text-[var(--text-secondary)] shrink-0" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
          <h2 className="text-[clamp(18px,2.4vw,21px)] font-semibold text-[var(--text-primary)]">{title}</h2>
        </div>
        {rows.some(r => r.why || r.raw?.length) && (
          <span className="text-[12px] text-[var(--text-secondary)]">Tap a step to see why</span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="text-[13px] text-[var(--text-secondary)] py-2">
          {liveData?._isAnomaly
            ? `“${liveData._itemName}” is not a stock item, so no steps were started.`
            : 'Steps appear here as soon as an order starts.'}
        </div>
      ) : (
        <StepList rows={rows} isOpen={isOpen} onToggle={toggle} onOpenDiagnostic={onOpenDiagnostic} />
      )}

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
