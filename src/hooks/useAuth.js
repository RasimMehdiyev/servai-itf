import {useState, useCallback} from 'react'

// Simple auth hook for prototype; replace internals with real backend logic later
export default function useAuth(){
  const [user, setUser] = useState(null)

  const login = useCallback((u)=>{
    setUser(u)
  },[])

  const logout = useCallback(()=>{
    setUser(null)
  },[])

  return {user, login, logout}
}
