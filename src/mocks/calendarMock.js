/**
 * Calendar history mock — generates 30 days of history data ending at today (2026-04-20).
 * Each day has a successRate, counts, and a set of orders for the day-detail view.
 *
 * The data is the single source of truth for:
 *   - The calendar grid (color-coded by success rate)
 *   - The /history/:dayId detail page
 */

const TODAY = '2026-04-20'

// Deterministic "random" from a seed so data is stable across renders
function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

const failureReasons = [
  'Dropped item',
  'Customer not found',
  'Path obstructed',
  'Grip failure',
  'Timeout waiting for customer',
  'Item out of stock',
]

function generateDay(dateStr, index) {
  const rng = seededRandom(index * 31 + 7)
  const totalOrders = Math.floor(rng() * 12) + 3 // 3–14 orders per day
  // Weighted: ~65% chance of >50% success
  const successRate = Math.floor(rng() * 100)
  const successCount = Math.round((successRate / 100) * totalOrders)
  const failureCount = totalOrders - successCount

  const orders = []
  for (let i = 0; i < totalOrders; i++) {
    const hour = 8 + Math.floor(rng() * 10)
    const min = Math.floor(rng() * 60)
    const ok = i < successCount
    orders.push({
      id: `${dateStr}-o${i + 1}`,
      orderNumber: String(1000 + Math.floor(rng() * 9000)),
      timestamp: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
      status: ok ? 'ok' : 'failed',
      rating: ok ? Math.floor(rng() * 2) + 4 : Math.floor(rng() * 3) + 1,
      failureReason: ok ? null : failureReasons[Math.floor(rng() * failureReasons.length)],
    })
  }
  // Sort by timestamp
  orders.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  const dateParts = dateStr.split('-')
  const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const dateLabel = `${monthNames[parseInt(dateParts[1], 10)]} ${parseInt(dateParts[2], 10)}, ${dateParts[0]}`

  return {
    id: dateStr,
    dateStr,
    dateLabel,
    isToday: dateStr === TODAY,
    successRate,
    ordersReceived: totalOrders,
    successCount,
    failureCount,
    attentionLabel: failureCount > 0 ? 'Needs Attention' : 'All Clear',
    orders,
  }
}

// Generate 30 days ending at TODAY
function generateCalendarDays() {
  const days = []
  const end = new Date(TODAY + 'T12:00:00')
  for (let i = 29; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    days.push(generateDay(dateStr, 29 - i))
  }
  return days
}

export const calendarDays = generateCalendarDays()

/** Lookup map: dateStr → day data (used by day-details service) */
export const calendarDayMap = Object.fromEntries(calendarDays.map(d => [d.id, d]))
