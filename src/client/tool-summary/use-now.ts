/** A ticking clock for live elapsed-time displays. */

import { useEffect, useState } from 'react'

/**
 * Returns `Date.now()` refreshed every `intervalMs` while `active` is true.
 * When inactive the value freezes on the last tick, so settled rows stop
 * re-rendering once they no longer need a live clock.
 */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => { setNow(Date.now()) }, intervalMs)
    return () => { clearInterval(id) }
  }, [active, intervalMs])
  return now
}
