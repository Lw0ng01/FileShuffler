import { useEffect, useState } from 'react'

/** The current time, refreshed a few times a second while `active` (for countdowns). */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [active])

  return now
}
