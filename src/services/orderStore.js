/**
 * Fetches order history from the server (ws-test-server's /api/orders endpoint).
 * All persistence is server-side in data/orders.json.
 */

const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8765'
const API_BASE = wsUrl.replace(/^ws/, 'http').replace(/\/$/, '')

export const FAILURE_DESCRIPTIONS = {
  'Grip failure': 'The gripper was not stable enough to hold onto the item.',
  'Item not detected': 'The item could not be detected at the expected location.',
  'Emergency stop': 'An emergency stop was triggered during operation.',
  'Robot error': 'The robot entered an error state during the cycle.',
  'Connection timeout': 'No updates were received from the robot for an extended period.',
  'Unknown failure': 'An unclassified failure occurred during the cycle.',
}

export async function fetchOrders() {
  const res = await fetch(`${API_BASE}/api/orders`)
  if (!res.ok) return []
  return res.json()
}

function dateStrFromISO(iso) {
  return new Date(iso).toISOString().slice(0, 10)
}

function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-')
  const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  return `${months[parseInt(m, 10)]} ${parseInt(d, 10)}, ${y}`
}

function isOk(order) {
  return order.status === 'ok' || order.status === 'success'
}

function normalizeOrder(order) {
  const status = isOk(order) ? 'ok' : 'failed'

  let timestamp = order.timestamp
  if (!timestamp && order.started_at) {
    const d = new Date(order.started_at)
    timestamp = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return {
    ...order,
    status,
    orderNumber: order.orderNumber || String(order.id),
    timestamp: timestamp || '',
    rating: order.rating ?? (status === 'ok' ? 5 : 1),
    failureReason: order.failureReason || null,
  }
}

export function buildDayMap(orders) {
  const byDate = {}

  for (const raw of orders) {
    const order = normalizeOrder(raw)
    const dateStr = dateStrFromISO(order.started_at)
    if (!byDate[dateStr]) byDate[dateStr] = []
    byDate[dateStr].push(order)
  }

  const today = new Date().toISOString().slice(0, 10)
  const dayMap = {}

  for (const [dateStr, dayOrders] of Object.entries(byDate)) {
    dayOrders.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
    const successCount = dayOrders.filter(o => o.status === 'ok').length
    const failureCount = dayOrders.length - successCount
    const successRate = dayOrders.length > 0
      ? Math.round((successCount / dayOrders.length) * 100)
      : 0

    dayMap[dateStr] = {
      id: dateStr,
      dateStr,
      dateLabel: formatDateLabel(dateStr),
      isToday: dateStr === today,
      successRate,
      ordersReceived: dayOrders.length,
      successCount,
      failureCount,
      attentionLabel: failureCount > 0 ? 'Needs Attention' : 'All Clear',
      orders: dayOrders,
    }
  }

  return dayMap
}
