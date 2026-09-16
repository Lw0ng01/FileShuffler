import { useEffect, useMemo, useRef, useState } from 'react'
import type { LibraryFile, LibrarySort } from '../../../shared/library'
import type { StatsView } from '../../../shared/stats'

export interface StatsActions {
  /** Stars a file, or unstars it if it is already a favorite. */
  toggleFavorite: (path: string) => void
  setNeverPlayedSort: (sort: LibrarySort) => void
  showMoreNeverPlayed: () => void
}

export interface NeverPlayedList {
  rows: LibraryFile[]
  sort: LibrarySort
  /** True while the list is full to what was asked for, so there may be more. */
  hasMore: boolean
}

/** Rows the view carries for never played, and how many each "show more" adds. */
const NEVER_PLAYED_PAGE = 10

interface NeverPlayedRequest {
  rows: LibraryFile[]
  sort: LibrarySort
  limit: number
}

/** Electron prefixes errors thrown in the main process; keep only the useful part. */
function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/**
 * The stats view from the main process, the favorite toggle, and the never-played list's sort and
 * paging. Presentation only, like the other hooks: which files count as known, and what "finished"
 * means, are decided in main.
 */
export function useStats(): {
  view: StatsView | null
  /** Paths currently starred, for drawing a filled or empty star on any row. */
  favorites: ReadonlySet<string>
  neverPlayed: NeverPlayedList
  error: string | null
  actions: StatsActions
} {
  const [view, setView] = useState<StatsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Set once the user re-sorts or asks for more; until then the view's own list is used. */
  const [request, setRequest] = useState<NeverPlayedRequest | null>(null)
  const latest = useRef<StatsView | null>(null)
  const latestRequest = useRef<NeverPlayedRequest | null>(null)

  useEffect(() => {
    latest.current = view
  }, [view])

  useEffect(() => {
    latestRequest.current = request
  }, [request])

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

  // Something played, so a re-sorted or longer list may be out of date: ask again in the same way.
  useEffect(() => {
    const current = latestRequest.current
    if (view === null || current === null) return
    let active = true
    window.api.stats
      .neverPlayed(current.limit, current.sort)
      .then((rows) => {
        if (active) setRequest((previous) => (previous === null ? previous : { ...previous, rows }))
      })
      .catch((caught: unknown) => {
        if (active) setError(cleanError(caught))
      })
    return () => {
      active = false
    }
  }, [view])

  const favorites = useMemo(
    () => new Set(view?.favorites.map((favorite) => favorite.path) ?? []),
    [view]
  )

  const neverPlayed = useMemo<NeverPlayedList>(() => {
    const rows = request?.rows ?? view?.neverPlayed ?? []
    const limit = request?.limit ?? NEVER_PLAYED_PAGE
    return { rows, sort: request?.sort ?? 'modified', hasMore: rows.length >= limit }
  }, [request, view])

  const actions = useMemo<StatsActions>(() => {
    const api = window.api.stats
    const load = (limit: number, sort: LibrarySort): void => {
      setError(null)
      api
        .neverPlayed(limit, sort)
        .then((rows) => setRequest({ rows, sort, limit }))
        .catch((caught: unknown) => setError(cleanError(caught)))
    }
    return {
      toggleFavorite: (path) => {
        setError(null)
        const starred = latest.current?.favorites.some((favorite) => favorite.path === path)
        const task = starred ? api.removeFavorite(path) : api.addFavorite(path)
        task.then(setView).catch((caught: unknown) => setError(cleanError(caught)))
      },
      setNeverPlayedSort: (sort) => load(latestRequest.current?.limit ?? NEVER_PLAYED_PAGE, sort),
      showMoreNeverPlayed: () => {
        const current = latestRequest.current
        load((current?.limit ?? NEVER_PLAYED_PAGE) + NEVER_PLAYED_PAGE, current?.sort ?? 'modified')
      }
    }
  }, [])

  return { view, favorites, neverPlayed, error, actions }
}
