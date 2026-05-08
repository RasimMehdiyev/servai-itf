import { calendarDayMap } from '../mocks/calendarMock'
import { allFailures as allFailuresBase } from '../mocks/historyMock'

const DATA_END = '2026-04-20'

function getFailuresByType(day) {
  const byType = {}
  if (day?.orders) {
    for (const order of day.orders) {
      if (order.failureReason) {
        byType[order.failureReason] = (byType[order.failureReason] ?? 0) + 1
      }
    }
  }
  return byType
}

function buildBars(start, end) {
  const bars = []
  const cursor = new Date(start)
  while (cursor <= end) {
    const dateStr = cursor.toISOString().slice(0, 10)
    const day = calendarDayMap[dateStr]
    bars.push({
      date: dateStr,
      success: day?.successCount ?? 0,
      failure: day?.failureCount ?? 0,
      failuresByType: getFailuresByType(day),
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return bars
}

function countByType(bars) {
  const counts = {}
  bars.forEach(b => {
    Object.entries(b.failuresByType).forEach(([type, count]) => {
      counts[type] = (counts[type] ?? 0) + count
    })
  })
  return counts
}

/**
 * @param {{ range?: string, startDate?: string, endDate?: string }} params
 */
export function fetchHistory({ range = '7d', startDate = null, endDate = null } = {}) {
  const end = new Date((endDate || DATA_END) + 'T12:00:00')

  let start
  if (startDate) {
    start = new Date(startDate + 'T12:00:00')
  } else {
    const days = range === '30d' ? 30 : range === '14d' ? 14 : 7
    start = new Date(end)
    start.setDate(start.getDate() - days + 1)
  }

  const bars = buildBars(start, end)

  // Previous period (same length, immediately before current start)
  const periodDays = bars.length
  const prevEnd = new Date(start)
  prevEnd.setDate(prevEnd.getDate() - 1)
  const prevStart = new Date(prevEnd)
  prevStart.setDate(prevStart.getDate() - periodDays + 1)
  const prevBars = buildBars(prevStart, prevEnd)

  const currentCounts = countByType(bars)
  const prevCounts = countByType(prevBars)

  // Compute allFailures with real counts and trends
  const computedFailures = allFailuresBase
    .map(f => {
      const curr = currentCounts[f.title] ?? 0
      const prev = prevCounts[f.title] ?? 0
      let trendDirection = 'neutral'
      let trendPercent = 0
      if (curr > prev) {
        trendDirection = 'up'
        trendPercent = prev === 0 ? 100 : Math.round(((curr - prev) / prev) * 100)
      } else if (curr < prev) {
        trendDirection = 'down'
        trendPercent = Math.round(((prev - curr) / prev) * 100)
      }
      return { ...f, count: curr, trendPercent, trendDirection }
    })
    .filter(f => f.count > 0)
    .sort((a, b) => b.count - a.count)

  // Collect failure types present in current period
  const typeSet = new Set()
  bars.forEach(b => Object.keys(b.failuresByType).forEach(t => typeSet.add(t)))
  const failureTypes = Array.from(typeSet).sort()

  const totalSuccess = bars.reduce((s, b) => s + b.success, 0)
  const totalFailure = bars.reduce((s, b) => s + b.failure, 0)
  const total = totalSuccess + totalFailure
  const successRate = total > 0 ? Math.round((totalSuccess / total) * 100) : 0

  return new Promise((resolve) =>
    setTimeout(() =>
      resolve({ successRate, successCount: totalSuccess, failureCount: totalFailure, performanceBars: bars, failureTypes, allFailures: computedFailures }),
      200
    )
  )
}
