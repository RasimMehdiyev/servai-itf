import { useState, useEffect, useCallback } from 'react'

const RAG_BASE = import.meta.env.VITE_RAG_URL || 'http://localhost:5174'

export default function useRagCaption(surface, scope) {
  const [caption, setCaption] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const scopeKey = JSON.stringify(scope || {})

  const fetchCaption = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)

      const res = await fetch(`${RAG_BASE}/api/rag/caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface, scope: scope || {} }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setCaption(data)
    } catch (err) {
      setError(err.message)
      setCaption({
        text: '_ROBI\'s report is unavailable right now — local AI is offline._',
        citations: [],
        _offline: true,
      })
    } finally {
      setLoading(false)
    }
  }, [surface, scopeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchCaption()
  }, [fetchCaption])

  return { caption, loading, error, refresh: fetchCaption }
}
