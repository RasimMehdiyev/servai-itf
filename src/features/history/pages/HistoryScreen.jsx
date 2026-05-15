import React, { useState, useMemo, useCallback } from 'react'
import TopBar from '../../../components/layout/TopBar'
import ScreenContainer from '../../../components/layout/ScreenContainer'
import WeeklySummaryCard from '../components/WeeklySummaryCard'
import ChatCard from '../components/ChatCard'
import ActivityChart from '../components/ActivityChart'
import OrdersList from '../components/OrdersList'
import ChatPanel from '../components/ChatPanel'
import ConnectionIndicator from '../../../components/ui/ConnectionIndicator'

function getToday() {
  return new Date().toISOString().slice(0, 10)
}

function getWeekAgo(endDate) {
  const d = new Date(endDate + 'T12:00:00')
  d.setDate(d.getDate() - 6)
  return d.toISOString().slice(0, 10)
}

function getMonthAgo(endDate) {
  const d = new Date(endDate + 'T12:00:00')
  d.setDate(d.getDate() - 29)
  return d.toISOString().slice(0, 10)
}

const RANGE_CHIPS = [
  { label: 'Today', getFrom: (today) => today },
  { label: 'Week', getFrom: (today) => getWeekAgo(today) },
  { label: 'Month', getFrom: (today) => getMonthAgo(today) },
]

export default function HistoryScreen() {
  const today = useMemo(getToday, [])
  const [rangeIdx, setRangeIdx] = useState(1) // default: Week
  const [chatOpen, setChatOpen] = useState(false)
  const [chatPrefill, setChatPrefill] = useState(null)

  const dateFrom = RANGE_CHIPS[rangeIdx].getFrom(today)
  const dateTo = today

  const handleCitationClick = useCallback((orderId) => {
    const el = document.getElementById(`order-${orderId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const handleAskRobi = useCallback((order) => {
    const id = order.order_number || order.id
    const msg = order.status === 'failed'
      ? `Why did order #${id} fail?`
      : `Why did order #${id} take ${order.robot_seconds || order.total_seconds}s?`
    setChatPrefill(msg)
    setChatOpen(true)
  }, [])

  const handleOpenChat = useCallback(() => {
    setChatPrefill(null)
    setChatOpen(true)
  }, [])

  const topLeft = (
    <>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="var(--text-secondary)" aria-hidden><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
      <span className="topbar-title">ROBI</span>
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
        {/* Weekly AI summary */}
        <div className="mt-lg">
          <WeeklySummaryCard onCitationClick={handleCitationClick} />
        </div>

        {/* Slim chat card */}
        <div className="mt-lg">
          <ChatCard onOpenChat={handleOpenChat} />
        </div>

        {/* Range chips */}
        <div className="mt-lg flex items-center gap-2">
          {RANGE_CHIPS.map((chip, i) => (
            <button
              key={chip.label}
              onClick={() => setRangeIdx(i)}
              className="px-4 py-1.5 rounded-full text-[12px] font-medium border border-solid cursor-pointer transition-colors"
              style={i === rangeIdx
                ? { background: '#111827', color: 'white', borderColor: '#111827' }
                : { background: 'white', color: '#374151', borderColor: '#e5e7eb' }
              }
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Activity chart */}
        <div className="mt-lg">
          <ActivityChart
            dateFrom={dateFrom}
            dateTo={dateTo}
            onCitationClick={handleCitationClick}
          />
        </div>

        {/* Orders list */}
        <div className="mt-lg">
          <OrdersList
            dateFrom={dateFrom}
            dateTo={dateTo}
            onCitationClick={handleCitationClick}
            onAskRobi={handleAskRobi}
          />
        </div>
      </ScreenContainer>

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        onCitationClick={handleCitationClick}
        prefill={chatPrefill}
      />
    </>
  )
}
