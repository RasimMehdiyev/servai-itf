import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Card from '../../../components/ui/Card'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Group calendar days by (year, month) → weeks grid.
 * Returns [ { key, label, weeks: [[null|day, ...], ...] }, ... ]
 */
function buildMonthGrids(days) {
  const months = new Map()
  for (const day of days) {
    const d = new Date(day.dateStr + 'T12:00:00')
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!months.has(key)) months.set(key, [])
    months.get(key).push(day)
  }

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const grids = []

  for (const [key, monthDays] of months) {
    const [year, mon] = key.split('-').map(Number)
    const label = `${monthNames[mon - 1]} ${year}`

    const firstOfMonth = new Date(year, mon - 1, 1)
    const startDow = (firstOfMonth.getDay() + 6) % 7
    const daysInMonth = new Date(year, mon, 0).getDate()

    const lookup = {}
    for (const d of monthDays) {
      const dom = parseInt(d.dateStr.split('-')[2], 10)
      lookup[dom] = d
    }

    const weeks = []
    let week = new Array(7).fill(null)
    let col = startDow

    for (let dom = 1; dom <= daysInMonth; dom++) {
      week[col] = lookup[dom] || { dateStr: null, dayOfMonth: dom, empty: true }
      if (!week[col].dayOfMonth) week[col].dayOfMonth = dom
      col++
      if (col === 7) {
        weeks.push(week)
        week = new Array(7).fill(null)
        col = 0
      }
    }
    if (week.some(c => c !== null)) weeks.push(week)

    grids.push({ key, label, weeks })
  }

  return grids
}

function cellClass(day) {
  if (!day || day.empty) return 'cal-cell cal-cell--empty'
  if (day.isToday) return 'cal-cell cal-cell--today'
  if (day.successRate >= 50) return 'cal-cell cal-cell--good'
  return 'cal-cell cal-cell--bad'
}

export default function HistoryCalendar({ days }) {
  const navigate = useNavigate()
  const grids = buildMonthGrids(days)
  const [monthIdx, setMonthIdx] = useState(grids.length - 1)

  const month = grids[monthIdx]
  if (!month) return null

  return (
    <Card>
      <div className="gap-row" style={{ marginBottom: 8 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--text-secondary)" aria-hidden>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" fill="none" stroke="var(--text-secondary)" strokeWidth="2"/>
          <line x1="16" y1="2" x2="16" y2="6" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round"/>
          <line x1="8" y1="2" x2="8" y2="6" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round"/>
          <line x1="3" y1="10" x2="21" y2="10" stroke="var(--text-secondary)" strokeWidth="2"/>
        </svg>
        <h2 style={{ fontSize: 'clamp(18px,2.4vw,21px)', fontWeight: 600 }}>Calendar</h2>
      </div>

      {/* Month navigation */}
      <div className="cal-nav">
        <button
          className="cal-nav__arrow"
          disabled={monthIdx === 0}
          onClick={() => setMonthIdx(i => i - 1)}
          aria-label="Previous month"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span className="cal-nav__label">{month.label}</span>
        <button
          className="cal-nav__arrow"
          disabled={monthIdx === grids.length - 1}
          onClick={() => setMonthIdx(i => i + 1)}
          aria-label="Next month"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>

      <div className="cal-grid">
        {WEEKDAYS.map(wd => (
          <div key={wd} className="cal-hdr">{wd}</div>
        ))}
        {month.weeks.flatMap((week, wi) =>
          week.map((cell, ci) => {
            if (!cell) return <div key={`${wi}-${ci}`} className="cal-cell cal-cell--blank" />
            const hasData = !cell.empty && cell.dateStr
            return (
              <button
                key={`${wi}-${ci}`}
                className={cellClass(cell)}
                disabled={!hasData}
                onClick={() => hasData && navigate(`/history/${cell.dateStr}`)}
                aria-label={hasData ? `${cell.dateStr}, ${cell.successRate}% success` : undefined}
                title={hasData ? `${cell.successRate}% success — ${cell.ordersReceived} orders` : undefined}
              >
                {cell.dayOfMonth || ''}
              </button>
            )
          })
        )}
      </div>

      {/* Legend */}
      <div className="cal-legend mt-sm">
        <span className="cal-legend__item"><span className="cal-legend__dot cal-legend__dot--good" /> ≥ 50% success</span>
        <span className="cal-legend__item"><span className="cal-legend__dot cal-legend__dot--bad" /> &lt; 50% success</span>
        <span className="cal-legend__item"><span className="cal-legend__dot cal-legend__dot--today" /> Today</span>
      </div>
    </Card>
  )
}
