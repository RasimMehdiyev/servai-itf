import React, { useState, useMemo } from 'react'
import TopBar from '../../../components/layout/TopBar'
import ScreenContainer from '../../../components/layout/ScreenContainer'
import PerformanceCard from '../components/PerformanceCard'
import OrderSummary from '../components/OrderSummary'
import LoadingState from '../../../components/ui/LoadingState'
import ErrorState from '../../../components/ui/ErrorState'
import ConnectionIndicator from '../../../components/ui/ConnectionIndicator'
import useHistorySummary from '../../../hooks/useHistorySummary'

function getToday() {
  return new Date().toISOString().slice(0, 10)
}

function getDefaultStart(endDate) {
  const d = new Date(endDate + 'T12:00:00')
  d.setDate(d.getDate() - 6)
  return d.toISOString().slice(0, 10)
}

function formatDateRange(start, end) {
  const fmt = (s) => new Date(s + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (start === end) return fmt(start)
  return `${fmt(start)} – ${fmt(end)}`
}

export default function HistoryScreen() {
  const today = useMemo(getToday, [])
  const defaultStart = useMemo(() => getDefaultStart(today), [today])

  const [custom, setCustom] = useState({ startDate: defaultStart, endDate: today })
  const [selectedDay, setSelectedDay] = useState(null)
  const [chartMode, setChartMode] = useState('failures')
  const isFail = chartMode === 'failures'

  const params = { startDate: custom.startDate, endDate: custom.endDate || custom.startDate }
  const { data, loading, error } = useHistorySummary(params)

  function handleDateChange(next) {
    setSelectedDay(null)
    setCustom(next)
  }

  function handleDaySelect(dateStr) {
    setSelectedDay(prev => (prev === dateStr ? null : dateStr))
  }

  const selectedBar = selectedDay && data
    ? data.performanceBars.find(b => b.date === selectedDay)
    : null

  // When a day is clicked, show ALL orders for that day
  const dayOrders = selectedBar?.orders ?? []

  const allFailedOrders = useMemo(() => {
    if (!data) return []
    return data.performanceBars
      .flatMap(b => b.orders.filter(o => o.status === 'failed'))
      .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))
  }, [data])

  const allSuccessOrders = useMemo(() => {
    if (!data) return []
    return data.performanceBars
      .flatMap(b => b.orders.filter(o => o.status === 'ok'))
      .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))
  }, [data])

  const summaryTitle = (() => {
    const dateLabel = selectedDay
      ? new Date(selectedDay + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      : null

    if (selectedDay) {
      const total = dayOrders.length
      return `${dateLabel} — ${total} order${total !== 1 ? 's' : ''}`
    }

    if (chartMode === 'failures') {
      return `Failures · ${formatDateRange(custom.startDate, custom.endDate || custom.startDate)}`
    }
    return `Orders · ${formatDateRange(custom.startDate, custom.endDate || custom.startDate)}`
  })()

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
                startDate={custom.startDate}
                endDate={custom.endDate}
                onDateChange={handleDateChange}
                onDateClear={() => { setSelectedDay(null); setCustom({ startDate: defaultStart, endDate: today }) }}
                selectedDay={selectedDay}
                onDaySelect={handleDaySelect}
                chartMode={chartMode}
                onChartModeChange={setChartMode}
              />
            </div>
            <div className="mt-lg">
              <OrderSummary
                title={summaryTitle}
                selectedDay={selectedDay}
                onClearDay={() => setSelectedDay(null)}
                orders={selectedDay ? dayOrders : (isFail ? allFailedOrders : allSuccessOrders)}
                chartMode={chartMode}
              />
            </div>
          </>
        )}
      </ScreenContainer>
    </>
  )
}
