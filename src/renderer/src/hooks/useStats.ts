import { useEffect, useMemo, useRef, useState } from 'react'
import type { StatsView } from '../../../shared/stats'

export interface StatsActions {
  /** Stars a file, or unstars it if it is already a favorite. */
  toggleFavorite: (path: string) => void
}

/** Electron prefixes errors thrown in the main process; keep only the useful part. */
function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/**
 * The stats view from the main process and the favorite toggle. Presentation only, like the other
 * hooks: which files count as known, and what "finished" means, are decided in main.
 */
export function useStats(): {
  view: StatsView | null
  /** Paths currently starred, for drawing a filled or empty star on any row. */
  favorites: ReadonlySet<string>
  error: string | null
  actions: StatsActions
} {
  const [view, setView] = useState<StatsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef<StatsView | null>(null)

  useEffect(() => {
    latest.current = view
  }, [view])

  useEffect(() => {
    const api = window.api.stats
    let active = true
    const unsubscribe = api.onView((next) => {
      if (active) setView(next)
    })
    api
      .getView()
      .then((initial) => {
        if (active) setView((current) => current ?? initial)
      })
      .catch((caught: unknown) => {
        if (active) setError(cleanError(caught))
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const favorites = useMemo(
    () => new Set(view?.favorites.map((favorite) => favorite.path) ?? []),
    [view]
  )

  const actions = useMemo<StatsActions>(() => {
    const api = window.api.stats
    return {
      toggleFavorite: (path) => {
        setError(null)
        const starred = latest.current?.favorites.some((favorite) => favorite.path === path)
        const task = starred ? api.removeFavorite(path) : api.addFavorite(path)
        task.then(setView).catch((caught: unknown) => setError(cleanError(caught)))
      }
    }
  }, [])

  return { view, favorites, error, actions }
}
