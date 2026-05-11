import React, { useState } from 'react'
import TopBar from '../../../components/layout/TopBar'
import ScreenContainer from '../../../components/layout/ScreenContainer'
import AttentionPanel from '../components/AttentionPanel'
import RobotStatusCard from '../components/RobotStatusCard'
import WorkflowTimeline from '../components/WorkflowTimeline'
import TechnicalDetails from '../components/TechnicalDetails'
import LoadingState from '../../../components/ui/LoadingState'
import ErrorState from '../../../components/ui/ErrorState'
import ConnectionIndicator from '../../../components/ui/ConnectionIndicator'
import useLiveDashboard from '../../../hooks/useLiveDashboard'
import { useDataSource } from '../../../context/DataSourceContext'
import { scenarioKeys, scenarioLabels } from '../../../mocks/liveMock'

export default function LiveScreen() {
  const { mode } = useDataSource()
  const [scenario, setScenario] = useState(scenarioKeys[0])
  const [diagnosticOpen, setDiagnosticOpen] = useState(false)
  const { data, loading, error } = useLiveDashboard(scenario)

  const topLeft = (
    <>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="var(--text-secondary)" aria-hidden><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
      <span className="topbar-title">{data?.storeId || 'ROBI'}</span>
      {mode === 'mock' && (
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
      )}
    </>
  )

  const topRight = (
    <div className="gap-row">
      <ConnectionIndicator />
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
            {/* Two-column: Now Serving + Right Now */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'clamp(12px,2vw,20px)', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <AttentionPanel
                  title={data.attentionTitle}
                  level={data.attentionLevel}
                  explanationTitle={data.explanationTitle}
                  explanationText={data.explanationText}
                  bullets={data.explanationBullets}
                  style={{ flex: 1 }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <RobotStatusCard
                  params={data.robotParams?.params}
                  suggestion={data.robotParams?.suggestion}
                  style={{ flex: 1 }}
                />
              </div>
            </div>

            {/* Pipeline — untouched */}
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

            {/* Technical details — collapsed accordion */}
            {data.robotParams && (
              <div className="mt-lg">
                <TechnicalDetails
                  params={data.robotParams.params}
                  suggestion={data.robotParams.suggestion}
                />
              </div>
            )}
          </>
        )}
      </ScreenContainer>
    </>
  )
}
