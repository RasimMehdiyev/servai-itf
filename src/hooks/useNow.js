import { useEffect, useState } from 'react'

/** Re-renders every `ms` while `active`, returning the current time in ms. Drives ticking timers. */
export default function useNow(active = true, ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [active, ms])
  return now
}
