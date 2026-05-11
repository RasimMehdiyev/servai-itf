import { useState, useEffect, useRef, useCallback } from 'react'

const MAX_BACKOFF = 30000
const INITIAL_BACKOFF = 1000

export default function useRobotSocket(url) {
  const [status, setStatus] = useState('disconnected')
  const [tick, setTick] = useState(0)
  const bufferRef = useRef([])
  const wsRef = useRef(null)
  const backoffRef = useRef(INITIAL_BACKOFF)
  const reconnectTimer = useRef(null)
  const unmountedRef = useRef(false)

  const connect = useCallback(() => {
    if (unmountedRef.current || !url) return

    setStatus('connecting')
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (unmountedRef.current) { ws.close(); return }
      backoffRef.current = INITIAL_BACKOFF
      setStatus('connected')
    }

    ws.onmessage = (event) => {
      if (unmountedRef.current) return
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
      setStatus('disconnected')
      scheduleReconnect()
    }

    ws.onerror = () => {}
  }, [url])

  function scheduleReconnect() {
    if (unmountedRef.current) return
    const delay = backoffRef.current
    backoffRef.current = Math.min(delay * 2, MAX_BACKOFF)
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

    return () => {
      unmountedRef.current = true
      clearTimeout(reconnectTimer.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [connect])

  const send = useCallback((message) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  return { status, tick, drain, send }
}
