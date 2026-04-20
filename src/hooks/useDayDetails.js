import {useState, useEffect} from 'react'
import { fetchDayDetails } from '../services/dayDetailsService'

export default function useDayDetails(id){
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(()=>{
    let mounted = true
    setLoading(true)
    fetchDayDetails(id).then(d=>{ if(mounted){ setData(d); setLoading(false) } }).catch(e=>{ if(mounted){ setError(e); setLoading(false) } })
    return ()=> { mounted = false }
  },[id])

  return {data, loading, error}
}
