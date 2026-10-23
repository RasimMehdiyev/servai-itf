import React, { createContext, useContext, useReducer, useEffect, useRef, useState, useCallback, useMemo } from 'react'
import useRobotSocket from '../hooks/useRobotSocket'
import { liveReducer, initialStateFor } from '../services/liveState'
import { getWsUrl, getApiBase } from '../lib/urls'
import { useRobot } from '../robots/RobotContext'

const isLiveMode = import.meta.env.VITE_USE_WEBSOCKET === 'true'

const DataSourceContext = createContext(null)

const IDLE_TIMEOUT = 15_000
const NO_ORDERS = { total: 0, failedCount: 0, recent: [] }

export function DataSourceProvider({ children }) {
  // Each robot has its own relay, so the selected robot decides the socket and the API the app talks to.
  const { robotId } = useRobot()
  const wsUrl = useMemo(() => getWsUrl(robotId), [robotId])
  const { status, tick, drain, send } = useRobotSocket(isLiveMode ? wsUrl : null)
  const [liveData, dispatch] = useReducer(liveReducer, robotId, initialStateFor)
  const [recentOrders, setRecentOrders] = useState(NO_ORDERS)
  const [sourceMode, setSourceMode] = useState('unknown')
  const [history, setHistory] = useState([])
  const idleTimer = useRef(null)

  const resetIdleTimer = useCallback(() => {
    clearTimeout(idleTimer.current)
    if (status === 'connected') {
      idleTimer.current = setTimeout(() => dispatch({ type: 'idle' }), IDLE_TIMEOUT)
    }
  }, [status])

  const fetchRecentOrders = useCallback(() => {
    const base = getApiBase(robotId)
    fetch(`${base}/api/recent-orders`)
      .then(r => r.json())
      .then(d => { if (getApiBase() === base) setRecentOrders(d) })
      .catch(() => {})
  }, [robotId])

  const fetchHistory = useCallback(() => {
    const base = getApiBase(robotId)
    fetch(`${base}/api/orders/slim`)
      .then(r => r.json())
      .then(list => { if (Array.isArray(list) && getApiBase() === base) setHistory(list) })
      .catch(() => {})
  }, [robotId])

  // Switching robots: drop everything that belonged to the previous one
  const shownRobot = useRef(robotId)
  useEffect(() => {
    if (shownRobot.current === robotId) return
    shownRobot.current = robotId
    clearTimeout(idleTimer.current)
    dispatch({ type: 'reset', data: initialStateFor(robotId) })
    setRecentOrders(NO_ORDERS)
    setHistory([])
    setSourceMode('unknown')
  }, [robotId])

  // Drain buffered messages on every tick
  useEffect(() => {
    if (!isLiveMode) return
    const msgs = drain()
    if (msgs.length === 0) return

    let needsOrderRefresh = false
    for (const msg of msgs) {
      if (msg.type === 'heartbeat') continue
      if (msg.type === 'source_mode') {
        // a relay for another robot answering on this port: say so instead of mixing the two
        setSourceMode(msg.robot && msg.robot !== robotId ? 'wrong-robot' : msg.mode)
        continue
      }
      dispatch({ type: 'ws_message', message: msg, robot: robotId })
      if (msg.type === 'cycle_end') needsOrderRefresh = true
    }

    resetIdleTimer()

    if (needsOrderRefresh) {
      setTimeout(() => { fetchRecentOrders(); fetchHistory() }, 500)
    }
  }, [tick, isLiveMode, drain, resetIdleTimer, fetchRecentOrders, fetchHistory, robotId])

  // Initial fetch, and again whenever the robot changes
  useEffect(() => {
    if (isLiveMode) { fetchRecentOrders(); fetchHistory() }
  }, [fetchRecentOrders, fetchHistory])

  useEffect(() => {
    return () => clearTimeout(idleTimer.current)
  }, [])

  const sendMessage = useCallback((msg) => {
    if (isLiveMode) send(msg)
  }, [isLiveMode, send])

  const value = {
    mode: isLiveMode ? 'live' : 'mock',
    connectionStatus: isLiveMode ? status : 'mock',
    sourceMode,
    liveData: isLiveMode ? liveData : null,
    recentOrders,
    history,
    sendMessage,
  }

  return (
    <DataSourceContext.Provider value={value}>
      {children}
    </DataSourceContext.Provider>
  )
}

export function useDataSource() {
  const ctx = useContext(DataSourceContext)
  if (!ctx) throw new Error('useDataSource must be used within DataSourceProvider')
  return ctx
}
