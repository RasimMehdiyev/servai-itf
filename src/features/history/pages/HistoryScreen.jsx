import React, { useState } from 'react'
import TopBar from '../../../components/layout/TopBar'
import ScreenContainer from '../../../components/layout/ScreenContainer'
import FilterPills from '../../../components/ui/FilterPills'
import PerformanceCard from '../components/PerformanceCard'
import FailureList from '../components/FailureList'
import HistoryCalendar from '../components/HistoryCalendar'
import LoadingState from '../../../components/ui/LoadingState'
import ErrorState from '../../../components/ui/ErrorState'
import useHistorySummary from '../../../hooks/useHistorySummary'

export default function HistoryScreen() {
  const [range, setRange] = useState('7d')
  const { data, loading, error } = useHistorySummary(range)

  const topLeft = (
    <>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="var(--text-secondary)" aria-hidden><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
      <span className="topbar-title">ROBI</span>
      <select aria-label="Select robot" defaultValue="ROBI" style={{ marginLeft: 4 }}>
        <option>ROBI</option>
        <option>ROBI-2</option>
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
        <FilterPills options={['7d', '14d', '30d']} value={range} onChange={setRange} />

        {loading && <LoadingState />}
        {error && <ErrorState />}
        {data && (
          <>
            <div className="mt-lg">
              <PerformanceCard
                successRate={data.successRate}
                successCount={data.successCount}
                failureCount={data.failureCount}
                bars={data.performanceBars}
              />
            </div>
            <div className="mt-lg">
              <FailureList failures={data.topFailures} />
            </div>
            {data.calendarDays && (
              <div className="mt-lg">
                <HistoryCalendar days={data.calendarDays} />
              </div>
            )}
          </>
        )}
      </ScreenContainer>
    </>
  )
}
