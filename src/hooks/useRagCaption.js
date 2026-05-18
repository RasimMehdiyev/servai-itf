import { useState, useEffect, useCallback, useRef } from 'react'

import { getRagBase } from '../lib/urls'

const RAG_BASE = getRagBase()

/**
 * AI caption hook — displays cached content immediately, generates only on demand.
 *
 * @param {string} surface       - 'chart' | 'orders_list' | 'weekly' | 'order_detail'
 * @param {object} scope         - date range, filters, etc.
 * @param {object|undefined} [stats]       - UI stats for prompt consistency
 * @param {object|null}      [initialCaption] - cached caption from the data response
 */
export default function useRagCaption(surface, scope, stats, initialCaption) {
  const [caption, setCaption] = useState(initialCaption || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const inflightRef = useRef(0)

  const scopeKey = JSON.stringify(scope || {})
  const statsKey = JSON.stringify(stats ?? 'none')

  // When the parent passes a new initialCaption (data loaded), adopt it
  useEffect(() => {
    if (initialCaption?.text) setCaption(initialCaption)
  }, [initialCaption?.text, initialCaption?.generated_at])

  // ── Generate / refresh — only runs when user clicks a button ──
  const generate = useCallback((force = false) => {
    if (stats === null) return

    const id = ++inflightRef.current
    setLoading(true)
    setError(null)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)

    const body = { surface, scope: scope || {} }
    if (stats !== undefined) body.stats = stats
    if (force) body.force = true

    fetch(`${RAG_BASE}/api/rag/caption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
      .then(res => {
        clearTimeout(timeout)
        if (!res.ok) throw new Error(`${res.status}`)
        return res.json()
      })
      .then(data => {
        if (id !== inflightRef.current) return
        setCaption(data)
        setError(null)
        setLoading(false)
      })
      .catch(err => {
        clearTimeout(timeout)
        if (id !== inflightRef.current) return
        setError(err.message)
        setLoading(false)
      })
  }, [surface, scopeKey, statsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => generate(true), [generate])

  return {
    caption,
    loading,
    error,
    generate,
    refresh,
    hasCaption: !!caption?.text,
    stale: !!error && !!caption?.text,
  }
}
