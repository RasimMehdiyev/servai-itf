import {useState, useEffect} from 'react'
import { fetchLive } from '../services/liveService'

export default function useLiveDashboard(scenarioKey){
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(()=>{
    let mounted = true
    setLoading(true)
    fetchLive(scenarioKey)
      .then(d=>{ if(mounted){ setData(d); setLoading(false) } })
      .catch(e=>{ if(mounted){ setError(e); setLoading(false) } })
    return ()=> { mounted = false }
  },[scenarioKey])

  return {data, loading, error}
}
