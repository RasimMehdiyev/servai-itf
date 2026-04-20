import React, { useState } from 'react'
import TopBar from '../../../components/layout/TopBar'
import ScreenContainer from '../../../components/layout/ScreenContainer'
import AttentionPanel from '../components/AttentionPanel'
import WorkflowTimeline from '../components/WorkflowTimeline'
import LoadingState from '../../../components/ui/LoadingState'
import ErrorState from '../../../components/ui/ErrorState'
import useLiveDashboard from '../../../hooks/useLiveDashboard'
import { scenarioKeys, scenarioLabels } from '../../../mocks/liveMock'

export default function LiveScreen() {
  const [scenario, setScenario] = useState(scenarioKeys[0])
  const [diagnosticOpen, setDiagnosticOpen] = useState(false)
  const { data, loading, error } = useLiveDashboard(scenario)

  const topLeft = (
    <>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="var(--text-secondary)" aria-hidden><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
      <span className="topbar-title">{data?.storeId || 'ROBI'}</span>
      <select
        aria-label="Select scenario"
        value={scenario}
        onChange={e => { setScenario(e.target.value); setDiagnosticOpen(false) }}
        style={{ marginLeft: 4 }}
      >
        {scenarioKeys.map(k => (
          <option key={k} value={k}>{scenarioLabels[k]}</option>
        ))}
      </select>
    </>
  )

  const topRight = (
    <div className="gap-row">
      <span className="status-dot status-dot--live" />
      <span style={{ color: 'var(--live-dot)', fontWeight: 600, fontSize: 'clamp(16px,2.0vw,17px)' }}>Live</span>
    </div>
  )

  return (
    <>
      <TopBar left={topLeft} right={topRight} />
      <ScreenContainer>
        {loading && <LoadingState />}
        {error && <ErrorState />}
        {data && (
          <>
            <AttentionPanel
              title={data.attentionTitle}
              level={data.attentionLevel}
              explanationTitle={data.explanationTitle}
              explanationText={data.explanationText}
              bullets={data.explanationBullets}
              onFulfillManually={() => { /* future API call */ }}
              onOpenCamera={() => setDiagnosticOpen(true)}
            />
            <div className="mt-lg">
              <WorkflowTimeline
                title={data.activeWorkflowTitle}
                earlierStepsCount={data.earlierStepsCount}
                steps={data.steps}
                validation={data.validation}
                resolutionActions={data.resolutionActions}
                diagnosticOpen={diagnosticOpen}
                onOpenDiagnostic={() => setDiagnosticOpen(true)}
                onCloseDiagnostic={() => setDiagnosticOpen(false)}
              />
            </div>
          </>
        )}
      </ScreenContainer>
    </>
  )
}
