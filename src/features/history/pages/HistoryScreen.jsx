import React, { useState, useMemo, useCallback } from 'react'
import TopBar from '../../../components/layout/TopBar'
import ScreenContainer from '../../../components/layout/ScreenContainer'
import WeeklySummaryCard from '../components/WeeklySummaryCard'
import ChatCard from '../components/ChatCard'
import ActivityHeatmap from '../components/ActivityHeatmap'
import OrdersList from '../components/OrdersList'
import FailureRadar from '../components/FailureRadar'
import ChatPanel from '../components/ChatPanel'
import ConnectionIndicator from '../../../components/ui/ConnectionIndicator'
import RobotSwitcher from '../../../components/layout/RobotSwitcher'

// Calendar days are local: the heatmap buckets orders by the operator's clock.
function fmtDay(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function getToday() {
  return fmtDay(new Date())
}

function daysBack(endDate, n) {
  const d = new Date(endDate + 'T12:00:00')
  d.setDate(d.getDate() - n)
  return fmtDay(d)
}

const RANGE_CHIPS = [
  { label: 'Today', getFrom: (today) => today },
  { label: 'Week', getFrom: (today) => daysBack(today, 6) },
  { label: 'Month', getFrom: (today) => daysBack(today, 29) },
  { label: 'Custom', custom: true },
]

export default function HistoryScreen() {
  const today = useMemo(getToday, [])
  const [rangeIdx, setRangeIdx] = useState(1) // default: Week
  const [custom, setCustom] = useState(() => ({ from: daysBack(getToday(), 13), to: getToday() })) // default: last 14 days
  const [chatOpen, setChatOpen] = useState(false)
  const [chatPrefill, setChatPrefill] = useState(null)

  const chip = RANGE_CHIPS[rangeIdx]
  const dateFrom = chip.custom ? custom.from : chip.getFrom(today)
  const dateTo = chip.custom ? custom.to : today

  // Keep a custom range valid: from <= to, never in the future
  const setCustomFrom = (v) => v && setCustom(c => ({ from: v, to: v > c.to ? v : c.to }))
  const setCustomTo = (v) => v && setCustom(c => ({ from: v < c.from ? v : c.from, to: v > today ? today : v }))

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
      <RobotSwitcher />
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

        {/* Range chips — drive the activity heatmap and the orders list together */}
        <div className="mt-lg flex items-center gap-2 flex-wrap">
          {RANGE_CHIPS.map((c, i) => (
            <button
              key={c.label}
              onClick={() => setRangeIdx(i)}
              aria-pressed={i === rangeIdx}
              className={`btn btn-sm rounded-full ${i === rangeIdx ? 'btn-neutral' : 'btn-outline'}`}
            >
              {c.label}
            </button>
          ))}
          {chip.custom && (
            <div className="flex items-center gap-2 ml-1 text-[13px] text-[var(--text-secondary)]">
              <label className="flex items-center gap-1.5">
                From
                <input type="date" className="input input-sm input-bordered" value={custom.from} max={today} onChange={e => setCustomFrom(e.target.value)} />
              </label>
              <label className="flex items-center gap-1.5">
                To
                <input type="date" className="input input-sm input-bordered" value={custom.to} max={today} onChange={e => setCustomTo(e.target.value)} />
              </label>
            </div>
          )}
        </div>

        {/* Activity: tally + heatmap */}
        <div className="mt-lg">
          <ActivityHeatmap dateFrom={dateFrom} dateTo={dateTo} />
        </div>

        {/* Failure radar + orders list — stacked in one block, chart first.
            The radar summarises which issues drove the orders listed below. */}
        <div className="mt-lg">
          <FailureRadar dateFrom={dateFrom} dateTo={dateTo} />
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
