import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  LibraryDigest,
  LibraryDuplicateGroup,
  LibraryFile,
  LibraryFolder,
  LibraryView
} from '../../../shared/library'

export interface LibraryActions {
  chooseRoot: () => void
  removeRoot: (path: string) => void
  scan: () => void
  cancelScan: () => void
  setTerm: (term: string) => void
  openFile: (path: string) => void
  showInFolder: (path: string) => void
  loadCleanup: () => void
  checkDuplicate: (name: string, size: number) => void
}

export interface CleanupLists {
  /** False until the lists have been asked for: they cost queries, so nothing loads uninvited. */
  loaded: boolean
  folders: LibraryFolder[]
  duplicates: LibraryDuplicateGroup[]
  stale: LibraryFile[]
  /** Fingerprints per checked group, keyed by `duplicateKey`. */
  checked: Record<string, LibraryDigest[]>
  checking: string | null
}

/** One key per duplicate group, since a name alone isn't unique. */
export function duplicateKey(name: string, size: number): string {
  return `${size}:${name}`
}

/** How old "not touched in a long time" means. */
export const STALE_DAYS = 180

/** Rows shown in the largest and recently changed lists. */
const LIST_LIMIT = 8
/** Search results shown at once. */
const SEARCH_LIMIT = 20
/** Waits this long after typing stops before searching, so each keystroke isn't a query. */
const SEARCH_DELAY_MS = 250

/** Electron prefixes errors thrown in the main process; keep only the useful part. */
function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/**
 * The library view from the main process, the lists the dashboard shows, and the actions that
 * change them. Mirrors `useShuffler`: the renderer holds no logic of its own (PROJECT.md §5).
 */
export function useLibrary(): {
  view: LibraryView | null
  largest: LibraryFile[]
  recent: LibraryFile[]
  results: LibraryFile[] | null
  term: string
  error: string | null
  cleanup: CleanupLists
  actions: LibraryActions
} {
  const [view, setView] = useState<LibraryView | null>(null)
  const [largest, setLargest] = useState<LibraryFile[]>([])
  const [recent, setRecent] = useState<LibraryFile[]>([])
  const [results, setResults] = useState<LibraryFile[] | null>(null)
  const [term, setTerm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cleanup, setCleanup] = useState<CleanupLists>({
    loaded: false,
    folders: [],
    duplicates: [],
    stale: [],
    checked: {},
    checking: null
  })
  /** What the lists were built from, so they refresh only when the index actually changed. */
  const listsFor = useRef<number | null>(null)

  const refreshLists = useCallback(async (): Promise<void> => {
    const api = window.api.library
    try {
      const [big, fresh] = await Promise.all([api.largest(LIST_LIMIT), api.recent(LIST_LIMIT)])
      setLargest(big)
      setRecent(fresh)
    } catch (caught) {
      setError(cleanError(caught))
    }
  }, [])

  useEffect(() => {
    const api = window.api.library
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

  // The lists come from separate queries, so they follow the view rather than arriving with it.
  useEffect(() => {
    if (view === null || view.status === 'scanning') return
    if (listsFor.current === view.files) return
    listsFor.current = view.files
    void refreshLists()
  }, [view, refreshLists])

  // Only the query lives here. Clearing happens in `changeTerm`, because setting state straight
  // away inside an effect makes React render twice for one change.
  useEffect(() => {
    const text = term.trim()
    if (text.length === 0) return
    let active = true
    const timer = setTimeout(() => {
      window.api.library
        .search(text, SEARCH_LIMIT)
        .then((found) => {
          if (active) setResults(found)
        })
        .catch((caught: unknown) => {
          if (active) setError(cleanError(caught))
        })
    }, SEARCH_DELAY_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [term, view?.files])

  const changeTerm = useCallback((next: string): void => {
    setTerm(next)
    // An empty box has nothing to search for, so the results go immediately.
    if (next.trim().length === 0) setResults(null)
  }, [])

  const actions = useMemo<LibraryActions>(() => {
    const api = window.api.library
    const run = (task: () => Promise<unknown>): void => {
      setError(null)
      task().catch((caught: unknown) => setError(cleanError(caught)))
    }
    return {
      chooseRoot: () => run(() => api.chooseRoot()),
      removeRoot: (path) => run(() => api.removeRoot(path)),
      scan: () => run(() => api.scan()),
      cancelScan: () => run(() => api.cancelScan()),
      setTerm: changeTerm,
      openFile: (path) => run(() => api.openFile(path)),
      showInFolder: (path) => run(() => api.showInFolder(path)),
      loadCleanup: () =>
        run(async () => {
          const [folders, duplicates, stale] = await Promise.all([
            api.biggestFolders(10),
            api.duplicates(15),
            api.notTouched(STALE_DAYS, 10)
          ])
          // Fingerprints belong to the groups they were taken from, so they start again here.
          setCleanup({ loaded: true, folders, duplicates, stale, checked: {}, checking: null })
        }),
      checkDuplicate: (name, size) => {
        const key = duplicateKey(name, size)
        setCleanup((current) => ({ ...current, checking: key }))
        run(async () => {
          try {
            const digests = await api.checkDuplicate(name, size)
            setCleanup((current) => ({
              ...current,
              checked: { ...current.checked, [key]: digests },
              checking: null
            }))
          } catch (caught) {
            setCleanup((current) => ({ ...current, checking: null }))
            throw caught
          }
        })
      }
    }
  }, [changeTerm])

  return { view, largest, recent, results, term, error, cleanup, actions }
}
