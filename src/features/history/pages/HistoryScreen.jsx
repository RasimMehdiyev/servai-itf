import React, { useState } from 'react'
import TopBar from '../../../components/layout/TopBar'
import ScreenContainer from '../../../components/layout/ScreenContainer'
import PerformanceCard from '../components/PerformanceCard'
import FailureList from '../components/FailureList'
import LoadingState from '../../../components/ui/LoadingState'
import ErrorState from '../../../components/ui/ErrorState'
import ConnectionIndicator from '../../../components/ui/ConnectionIndicator'
import useHistorySummary from '../../../hooks/useHistorySummary'
import { allFailures as allFailuresBase } from '../../../mocks/historyMock'

const DATA_END = '2026-04-20'

function getDefaultStart() {
  const d = new Date(DATA_END + 'T12:00:00')
  d.setDate(d.getDate() - 6)
  return d.toISOString().slice(0, 10)
}
const DEFAULT_START = getDefaultStart()

function formatDateRange(start, end) {
  const fmt = (s) => new Date(s + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (start === end) return fmt(start)
  return `${fmt(start)} – ${fmt(end)}`
}

export default function HistoryScreen() {
  const [custom, setCustom] = useState({ startDate: DEFAULT_START, endDate: DATA_END })
  const [selectedDay, setSelectedDay] = useState(null)

  const params = { startDate: custom.startDate, endDate: custom.endDate || custom.startDate }
  const { data, loading, error } = useHistorySummary(params)

  function handleDateChange(next) {
    setSelectedDay(null)
    setCustom(next)
  }

  function handleDaySelect(dateStr) {
    setSelectedDay(prev => (prev === dateStr ? null : dateStr))
  }

  // Build per-day failure list from bar data when a day is selected
  const displayFailures = (() => {
    if (!data) return []
    if (!selectedDay) return data.allFailures
    const bar = data.performanceBars.find(b => b.date === selectedDay)
    if (!bar) return []
    return allFailuresBase
      .map(f => ({ ...f, count: bar.failuresByType?.[f.title] ?? 0 }))
      .filter(f => f.count > 0)
      .sort((a, b) => b.count - a.count)
  })()

  const failureListTitle = selectedDay
    ? new Date(selectedDay + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : `Failures · ${formatDateRange(custom.startDate, custom.endDate || custom.startDate)}`

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
            <div className="mt-lg">
              <PerformanceCard
                successCount={data.successCount}
                failureCount={data.failureCount}
                bars={data.performanceBars}
                failureTypes={data.failureTypes || []}
                startDate={custom.startDate}
                endDate={custom.endDate}
                onDateChange={handleDateChange}
                onDateClear={() => { setSelectedDay(null); setCustom({ startDate: DEFAULT_START, endDate: DATA_END }) }}
                selectedDay={selectedDay}
                onDaySelect={handleDaySelect}
              />
            </div>
            <div className="mt-lg">
              <FailureList
                failures={displayFailures}
                title={failureListTitle}
                selectedDay={selectedDay}
                onClearDay={() => setSelectedDay(null)}
              />
            </div>
          </>
        )}
      </ScreenContainer>
    </>
  )
}
