import { useEffect, useRef } from 'react'

/**
 * Calls `onReturn` whenever the window comes back: it gets focus, or becomes visible again after
 * being minimised or covered by another window - for example the system player a file was handed
 * to, closing.
 *
 * Two things need that moment, so there is one definition of it: the video stage retries a start
 * Chromium refused while the window was in the background, and `DragRegionRefresh` has the drag
 * areas sent to the OS again.
 */
export function useWindowReturn(onReturn: () => void): void {
  // Kept in a ref so the listeners are attached once, not again on every render.
  const latest = useRef(onReturn)

  useEffect(() => {
    latest.current = onReturn
  }, [onReturn])

  useEffect(() => {
    const onChange = (): void => {
      if (document.visibilityState === 'visible') latest.current()
    }
    window.addEventListener('focus', onChange)
    document.addEventListener('visibilitychange', onChange)
    return () => {
      window.removeEventListener('focus', onChange)
      document.removeEventListener('visibilitychange', onChange)
    }
  }, [])
}
