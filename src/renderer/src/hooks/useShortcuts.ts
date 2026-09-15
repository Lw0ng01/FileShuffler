import { useEffect, useRef } from 'react'
import type { ShufflerView } from '../../../shared/shuffler'
import type { ShufflerActions } from './useShuffler'

/**
 * Keyboard shortcuts while this window has focus. They are not global: inside the mpv window its
 * own bindings apply (PROJECT.md §4).
 * - → or > next, ← or < back
 * - Delete, or ⌘/Ctrl+Backspace, deletes the current video
 * - ⌘/Ctrl+Z undoes the most recent delete
 */
export function useShortcuts(view: ShufflerView, actions: ShufflerActions): void {
  const latest = useRef({ view, actions })

  useEffect(() => {
    latest.current = { view, actions }
  }, [view, actions])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat) return
      const { view: currentView, actions: currentActions } = latest.current
      const modifier = event.metaKey || event.ctrlKey

      if (modifier && event.key.toLowerCase() === 'z') {
        const newest = currentView.pendingDeletes[currentView.pendingDeletes.length - 1]
        if (newest === undefined) return
        event.preventDefault()
        currentActions.undoDelete(newest.id)
      } else if (modifier && event.key === 'Backspace') {
        event.preventDefault()
        currentActions.deleteCurrent()
      } else if (modifier || event.altKey) {
        return
      } else if (event.key === 'ArrowRight' || event.key === '>') {
        event.preventDefault()
        currentActions.next()
      } else if (event.key === 'ArrowLeft' || event.key === '<') {
        event.preventDefault()
        currentActions.back()
      } else if (event.key === 'Delete') {
        event.preventDefault()
        currentActions.deleteCurrent()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
