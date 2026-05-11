import {useState, useEffect} from 'react'
import { fetchLive } from '../services/liveService'
import { useDataSource } from '../context/DataSourceContext'

export default function useLiveDashboard(scenarioKey){
  const { mode, liveData } = useDataSource()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(()=>{
    if (mode === 'live') return
    let mounted = true
    setLoading(true)
    fetchLive(scenarioKey)
      .then(d=>{ if(mounted){ setData(d); setLoading(false) } })
      .catch(e=>{ if(mounted){ setError(e); setLoading(false) } })
    return ()=> { mounted = false }
  },[scenarioKey, mode])

  if (mode === 'live') {
    return { data: liveData, loading: false, error: null }
  }

  return {data, loading, error}
}
