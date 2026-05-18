import React, { createContext, useContext, useReducer, useEffect, useRef, useState, useCallback } from 'react'
import useRobotSocket from '../hooks/useRobotSocket'
import { applyMessageToScenario } from '../services/messageMapper'
import { getWsUrl, getApiBase } from '../lib/urls'

const isLiveMode = import.meta.env.VITE_USE_WEBSOCKET === 'true'
const wsUrl = getWsUrl()

const DataSourceContext = createContext(null)

const IDLE_TIMEOUT = 15_000

function liveReducer(state, action) {
  switch (action.type) {
    case 'ws_message': {
      const next = { ...applyMessageToScenario(state, action.message), _idle: false }
      if (action.message._catchUp && next.progress) {
        next.progress = { ...next.progress, animDuration: 0 }
      }
      return next
    }
    case 'idle':
      if (state._idle) return state
      return {
        ...state,
        _idle: true,
        _cardState: 'red',
        attentionLevel: 'needs_attention',
        explanationText: 'No updates received for a while. The robot may be stuck or disconnected.',
        _cycleFailures: [...(state._cycleFailures || []), {
          level: 'red',
          message: 'Connection timeout — no updates received',
          ts: new Date().toISOString(),
        }],
      }
    case 'reset':
      return action.data
    default:
      return state
  }
}

const liveInitialState = {
  storeId: 'ROBI',
  liveStatus: 'live',
  orderId: '',
  attentionTitle: 'Waiting for orders…',
  attentionLevel: 'ok',
  explanationTitle: 'STATUS',
  explanationText: 'The robot is connected and ready. It will start when an order comes in.',
  explanationBullets: [],
  validation: null,
  resolutionActions: [],
  robotParams: null,
  activeWorkflowTitle: 'What I am doing right now',
  earlierStepsCount: 0,
  steps: [],
  _cardState: 'green',
  _cycleStartedAt: null,
  progress: { fraction: 0, milestone: 0, animDuration: 0 },
}

export function DataSourceProvider({ children }) {
  const { status, tick, drain, send } = useRobotSocket(isLiveMode ? wsUrl : null)
  const [liveData, dispatch] = useReducer(liveReducer, liveInitialState)
  const [recentOrders, setRecentOrders] = useState({ total: 0, failedCount: 0, recent: [] })
  const [sourceMode, setSourceMode] = useState('unknown')
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
      setTimeout(fetchRecentOrders, 500)
    }
  }, [tick, isLiveMode, drain, resetIdleTimer, fetchRecentOrders])

  // Initial fetch
  useEffect(() => {
    if (isLiveMode) fetchRecentOrders()
  }, [fetchRecentOrders])

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
