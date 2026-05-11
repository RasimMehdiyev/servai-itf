import { fetchOrders, buildDayMap } from './orderStore'

export async function fetchDayDetails(id) {
  const orders = await fetchOrders()
  const dayMap = buildDayMap(orders)
  const dayData = dayMap[id]
  if (dayData) return dayData
  return {
    id,
    dateStr: id,
    dateLabel: id,
    isToday: false,
    successRate: 0,
    ordersReceived: 0,
    successCount: 0,
    failureCount: 0,
    attentionLabel: 'All Clear',
    orders: [],
  }
}
