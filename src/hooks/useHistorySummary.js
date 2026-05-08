import { useState, useEffect } from 'react'
import { fetchHistory } from '../services/historyService'

/**
 * @param {{ range?: string, startDate?: string, endDate?: string } | string} params
 */
export default function useHistorySummary(params = { range: '7d' }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const key = JSON.stringify(params)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    const p = typeof params === 'string' ? { range: params } : params
    fetchHistory(p)
      .then(d => { if (mounted) { setData(d); setLoading(false) } })
      .catch(e => { if (mounted) { setError(e); setLoading(false) } })
    return () => { mounted = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error }
}
