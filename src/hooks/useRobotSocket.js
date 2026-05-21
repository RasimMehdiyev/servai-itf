import { useState, useEffect, useRef, useCallback } from 'react'

const MAX_BACKOFF = 10000
const INITIAL_BACKOFF = 1000
const PING_INTERVAL = 15000
// If we don't hear *anything* from the server in this long, treat the socket
// as dead and force a reconnect. The server heartbeats every ~4 s while events
// flow and ws-level pings every 25 s while idle, so 45 s of silence is
// abnormal even on flaky iPad networks.
const SILENCE_TIMEOUT = 45000

export default function useRobotSocket(url) {
  const [status, setStatus] = useState('disconnected')
  const [tick, setTick] = useState(0)
  const bufferRef = useRef([])
  const wsRef = useRef(null)
  const backoffRef = useRef(INITIAL_BACKOFF)
  const reconnectTimer = useRef(null)
  const pingTimer = useRef(null)
  const watchdogTimer = useRef(null)
  const lastMessageAt = useRef(0)
  const unmountedRef = useRef(false)

  const stopPing = useCallback(() => {
    if (pingTimer.current) { clearInterval(pingTimer.current); pingTimer.current = null }
  }, [])

  const stopWatchdog = useCallback(() => {
    if (watchdogTimer.current) { clearInterval(watchdogTimer.current); watchdogTimer.current = null }
  }, [])

  const startPing = useCallback(() => {
    stopPing()
    pingTimer.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }))
      }
    }, PING_INTERVAL)
  }, [stopPing])

  const startWatchdog = useCallback(() => {
    stopWatchdog()
    lastMessageAt.current = Date.now()
    watchdogTimer.current = setInterval(() => {
      if (Date.now() - lastMessageAt.current > SILENCE_TIMEOUT) {
        console.warn('[useRobotSocket] socket silent — forcing reconnect')
        try { wsRef.current?.close() } catch {}
      }
    }, 5000)
  }, [stopWatchdog])

  const connect = useCallback(() => {
    if (unmountedRef.current || !url) return

    setStatus('connecting')
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (unmountedRef.current) { ws.close(); return }
      backoffRef.current = INITIAL_BACKOFF
      setStatus('connected')
      startPing()
      startWatchdog()
    }

    ws.onmessage = (event) => {
      if (unmountedRef.current) return
      lastMessageAt.current = Date.now()
      try {
        const msg = JSON.parse(event.data)
        bufferRef.current.push(msg)
        setTick(t => t + 1)
      } catch {
        console.warn('[useRobotSocket] Non-JSON message received')
      }
    }

    ws.onclose = () => {
      if (unmountedRef.current) return
      stopPing()
      stopWatchdog()
      setStatus('disconnected')
      scheduleReconnect()
    }

    ws.onerror = () => {}
  }, [url, startPing, stopPing, startWatchdog, stopWatchdog])

  function scheduleReconnect() {
    if (unmountedRef.current) return
    const delay = backoffRef.current
    backoffRef.current = Math.min(delay * 1.5, MAX_BACKOFF)
    reconnectTimer.current = setTimeout(connect, delay)
  }

  const drain = useCallback(() => {
    const msgs = bufferRef.current
    if (msgs.length === 0) return []
    bufferRef.current = []
    return msgs
  }, [])

  useEffect(() => {
    unmountedRef.current = false
    connect()

    // When the tab becomes visible again, kick a reconnect immediately if the
    // socket isn't open. iOS suspends timers on hidden tabs, so the backoff
    // timer often misses.
    const onVisible = () => {
      if (document.visibilityState === 'visible'
          && wsRef.current?.readyState !== WebSocket.OPEN) {
        clearTimeout(reconnectTimer.current)
        backoffRef.current = INITIAL_BACKOFF
        connect()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      unmountedRef.current = true
      stopPing()
      stopWatchdog()
      document.removeEventListener('visibilitychange', onVisible)
      clearTimeout(reconnectTimer.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [connect, stopPing, stopWatchdog])

  const send = useCallback((message) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  return { status, tick, drain, send }
}
