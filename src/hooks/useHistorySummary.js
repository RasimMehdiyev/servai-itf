import {useState, useEffect} from 'react'
import { fetchHistory } from '../services/historyService'

export default function useHistorySummary(range = '7d'){
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(()=>{
    let mounted = true
    setLoading(true)
    fetchHistory(range).then(d=>{ if(mounted){ setData(d); setLoading(false) } }).catch(e=>{ if(mounted){ setError(e); setLoading(false) } })
    return ()=> { mounted = false }
  },[range])

  return {data, loading, error}
}
