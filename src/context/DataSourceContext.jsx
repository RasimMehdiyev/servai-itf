import React, { createContext, useContext, useReducer, useEffect, useRef, useState, useCallback } from 'react'
import useRobotSocket from '../hooks/useRobotSocket'
import { liveReducer, liveInitialState } from '../services/liveState'
import { getWsUrl, getApiBase } from '../lib/urls'

const isLiveMode = import.meta.env.VITE_USE_WEBSOCKET === 'true'
const wsUrl = getWsUrl()

const DataSourceContext = createContext(null)

const IDLE_TIMEOUT = 15_000

export function DataSourceProvider({ children }) {
  const { status, tick, drain, send } = useRobotSocket(isLiveMode ? wsUrl : null)
  const [liveData, dispatch] = useReducer(liveReducer, liveInitialState)
  const [recentOrders, setRecentOrders] = useState({ total: 0, failedCount: 0, recent: [] })
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
    const base = getApiBase()
    fetch(`${base}/api/recent-orders`)
      .then(r => r.json())
      .then(setRecentOrders)
      .catch(() => {})
  }, [])

  const fetchHistory = useCallback(() => {
    const base = getApiBase()
    fetch(`${base}/api/orders/slim`)
      .then(r => r.json())
      .then(list => { if (Array.isArray(list)) setHistory(list) })
      .catch(() => {})
  }, [])

  // Drain buffered messages on every tick
  useEffect(() => {
    if (!isLiveMode) return
    const msgs = drain()
    if (msgs.length === 0) return

    let needsOrderRefresh = false
    for (const msg of msgs) {
      if (msg.type === 'heartbeat') continue
      if (msg.type === 'source_mode') { setSourceMode(msg.mode); continue }
      dispatch({ type: 'ws_message', message: msg })
      if (msg.type === 'cycle_end') needsOrderRefresh = true
    }

    resetIdleTimer()

    if (needsOrderRefresh) {
      setTimeout(() => { fetchRecentOrders(); fetchHistory() }, 500)
    }
  }, [tick, isLiveMode, drain, resetIdleTimer, fetchRecentOrders, fetchHistory])

  // Initial fetch
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
