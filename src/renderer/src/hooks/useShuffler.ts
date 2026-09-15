import { useEffect, useMemo, useState } from 'react'
import type { ShufflerView } from '../../../shared/shuffler'

export interface ShufflerActions {
  chooseFolder: () => void
  play: () => void
  next: () => void
  back: () => void
  deleteCurrent: () => void
  undoDelete: (id: string) => void
}

/** Electron prefixes errors thrown in the main process; keep only the useful part. */
function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** The latest shuffler view from the main process, plus actions that report their own errors. */
export function useShuffler(): {
  view: ShufflerView | null
  actions: ShufflerActions
  actionError: string | null
} {
  const [view, setView] = useState<ShufflerView | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    const api = window.api.shuffler
    let active = true
    const unsubscribe = api.onView((next) => {
      if (active) setView(next)
    })
    api
      .getView()
      .then((initial) => {
        // A pushed update may already have arrived; never overwrite it with an older snapshot.
        if (active) setView((current) => current ?? initial)
      })
      .catch((error: unknown) => {
        if (active) setActionError(cleanError(error))
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const actions = useMemo<ShufflerActions>(() => {
    const api = window.api.shuffler
    const run = (task: () => Promise<unknown>): void => {
      setActionError(null)
      task().catch((error: unknown) => setActionError(cleanError(error)))
    }
    return {
      chooseFolder: () => run(() => api.chooseFolder()),
      play: () => run(() => api.play()),
      next: () => run(() => api.next()),
      back: () => run(() => api.back()),
      deleteCurrent: () => run(() => api.deleteCurrent()),
      undoDelete: (id) => run(() => api.undoDelete(id))
    }
  }, [])

  return { view, actions, actionError }
}
