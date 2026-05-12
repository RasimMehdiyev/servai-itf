/**
 * Deterministic statistics computation.
 * These numbers are passed as facts to the LLM — the model phrases, not counts.
 */

const fs = require('fs')
const path = require('path')

const ORDERS_FILE = path.join(__dirname, '..', '..', 'data', 'orders.json')

function readOrders() {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')) }
  catch { return [] }
}

function filterByDateRange(orders, startDate, endDate) {
  return orders.filter(o => {
    const d = o.started_at?.slice(0, 10)
    if (!d) return false
    return d >= startDate && d <= endDate
  })
}

function computeStats(orders) {
  const total = orders.length
  const success = orders.filter(o => o.status === 'success' || o.status === 'ok').length
  const failed = total - success

  const times = orders.map(o => o.total_seconds || 0).filter(t => t > 0)
  const avgTime = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0
  const medianTime = times.length > 0 ? times.sort((a, b) => a - b)[Math.floor(times.length / 2)] : 0

  const robotTimes = orders.map(o => o.robot_seconds || 0).filter(t => t > 0)
  const avgRobotTime = robotTimes.length > 0 ? Math.round(robotTimes.reduce((a, b) => a + b, 0) / robotTimes.length) : 0

  // Item distribution
  const items = {}
  for (const o of orders) {
    const item = o.item || 'unknown'
    items[item] = (items[item] || 0) + 1
  }
  const itemRanking = Object.entries(items).sort((a, b) => b[1] - a[1])

  // Day distribution
  const days = {}
  for (const o of orders) {
    const d = o.started_at?.slice(0, 10)
    if (d) days[d] = (days[d] || 0) + 1
  }
  const busiestDay = Object.entries(days).sort((a, b) => b[1] - a[1])[0]

  // Failure breakdown
  const failures = {}
  for (const o of orders) {
    if (o.status === 'failed' || (o.status !== 'success' && o.status !== 'ok')) {
      const reason = o.failure?.reason || o.failureReason || 'unknown'
      failures[reason] = (failures[reason] || 0) + 1
    }
  }

  // Slowest order
  const slowest = orders.reduce((max, o) => (o.total_seconds || 0) > (max?.total_seconds || 0) ? o : max, null)

  return {
    total, success, failed,
    avgTime, medianTime, avgRobotTime,
    itemRanking, busiestDay: busiestDay ? { date: busiestDay[0], count: busiestDay[1] } : null,
    failures,
    slowest: slowest ? { id: slowest.id, item: slowest.item, total_seconds: slowest.total_seconds } : null,
  }
}

function weeklyStats() {
  const orders = readOrders()
  const today = new Date().toISOString().slice(0, 10)
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const filtered = filterByDateRange(orders, weekAgo, today)
  return { ...computeStats(filtered), startDate: weekAgo, endDate: today }
}

function rangeStats(startDate, endDate) {
  const orders = readOrders()
  const filtered = filterByDateRange(orders, startDate, endDate)
  return { ...computeStats(filtered), startDate, endDate }
}

function dailyStats(date) {
  const orders = readOrders()
  const filtered = filterByDateRange(orders, date, date)
  return { ...computeStats(filtered), date }
}

function orderDetail(orderId) {
  const orders = readOrders()
  return orders.find(o => o.id === orderId) || null
}

function retrieveOrders({ startDate, endDate, status, item, limit = 20 }) {
  let orders = readOrders()
  if (startDate) orders = orders.filter(o => (o.started_at?.slice(0, 10) || '') >= startDate)
  if (endDate) orders = orders.filter(o => (o.started_at?.slice(0, 10) || '') <= endDate)
  if (status) orders = orders.filter(o => o.status === status)
  if (item) orders = orders.filter(o => o.item === item)
  return orders.slice(-limit)
}

module.exports = { readOrders, computeStats, weeklyStats, rangeStats, dailyStats, orderDetail, retrieveOrders, filterByDateRange }
