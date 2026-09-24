import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  LibraryCategory,
  LibraryDigest,
  LibraryDuplicateGroup,
  LibraryFile,
  LibraryFilePage,
  LibraryFileQuery,
  LibraryFolder,
  LibrarySort,
  LibraryView
} from '../../../shared/library'

/** What the dashboard's search box and filter bar are set to. */
export interface SearchFilters {
  term: string
  categories: LibraryCategory[]
  drive: string | null
  /** Smallest size to show, in bytes, or null for any size. */
  minSize: number | null
  sort: LibrarySort
  direction: 'asc' | 'desc'
}

const EMPTY_FILTERS: SearchFilters = {
  term: '',
  categories: [],
  drive: null,
  minSize: null,
  sort: 'modified',
  direction: 'desc'
}

/**
 * True when the search box or a filter narrows the index. Filters work without a search term, so
 * "videos over 1 GB on F:" needs no typing.
 */
export function filtersActive(filters: SearchFilters): boolean {
  return (
    filters.term.trim().length > 0 ||
    filters.categories.length > 0 ||
    filters.drive !== null ||
    filters.minSize !== null
  )
}

function toQuery(filters: SearchFilters): LibraryFileQuery {
  const query: LibraryFileQuery = { sort: filters.sort, direction: filters.direction }
  const term = filters.term.trim()
  if (term.length > 0) query.term = term
  if (filters.categories.length > 0) query.categories = filters.categories
  if (filters.drive !== null) query.drives = [filters.drive]
  if (filters.minSize !== null) query.minSize = filters.minSize
  return query
}

export interface LibraryActions {
  chooseRoot: () => void
  removeRoot: (path: string) => void
  chooseExcluded: () => void
  removeExcluded: (path: string) => void
  scan: () => void
  cancelScan: () => void
  scanRoot: (path: string) => void
  setTerm: (term: string) => void
  toggleCategory: (category: LibraryCategory) => void
  setDrive: (drive: string | null) => void
  setMinSize: (bytes: number | null) => void
  /** Picks what to sort by, with the direction that suits it: A to Z, largest or newest first. */
  setSort: (sort: LibrarySort) => void
  toggleDirection: () => void
  clearFilters: () => void
  showMoreResults: () => void
  showMoreLargest: () => void
  showMoreRecent: () => void
  openFile: (path: string) => void
  showInFolder: (path: string) => void
  loadCleanup: () => void
  showMoreFolders: () => void
  showMoreDuplicates: () => void
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
  /** How many rows were asked for, so "show more" can tell when nothing is left. */
  folderLimit: number
  duplicateLimit: number
}

/** One key per duplicate group, since a name alone isn't unique. */
export function duplicateKey(name: string, size: number): string {
  return `${size}:${name}`
}

/** How old "not touched in a long time" means. */
export const STALE_DAYS = 180

/** Rows added by each "show more", per list. */
const LIST_PAGE = 8
const SEARCH_PAGE = 25
const FOLDER_PAGE = 10
const DUPLICATE_PAGE = 15
/** Waits this long after the last change before searching, so each keystroke isn't a query. */
const SEARCH_DELAY_MS = 250

const EMPTY_PAGE: LibraryFilePage = { rows: [], total: 0 }
const LARGEST: LibraryFileQuery = { sort: 'size', direction: 'desc' }
const RECENT: LibraryFileQuery = { sort: 'modified', direction: 'desc' }

/** Electron prefixes errors thrown in the main process; keep only the useful part. */
function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/**
 * The library view from the main process, the lists the dashboard shows, and the actions that
 * change them. Mirrors `useShuffler`: the renderer holds no logic of its own (PROJECT.md §5).
 * Filtering, sorting and paging all happen in the store; this only says what to ask for.
 */
export function useLibrary(): {
  view: LibraryView | null
  largest: LibraryFilePage
  recent: LibraryFilePage
  /** Null while no search or filter is active, so the default lists show instead. */
  results: LibraryFilePage | null
  filters: SearchFilters
  error: string | null
  cleanup: CleanupLists
  actions: LibraryActions
} {
  const [view, setView] = useState<LibraryView | null>(null)
  const [largest, setLargest] = useState<LibraryFilePage>(EMPTY_PAGE)
  const [recent, setRecent] = useState<LibraryFilePage>(EMPTY_PAGE)
  const [results, setResults] = useState<LibraryFilePage | null>(null)
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS)
  const [error, setError] = useState<string | null>(null)
  const [cleanup, setCleanup] = useState<CleanupLists>({
    loaded: false,
    folders: [],
    duplicates: [],
    stale: [],
    checked: {},
    checking: null,
    folderLimit: FOLDER_PAGE,
    duplicateLimit: DUPLICATE_PAGE
  })

  /** Current state for the actions, which are created once and would otherwise see old values. */
  const latest = useRef({ largest, recent, results, filters, cleanup })
  useEffect(() => {
    latest.current = { largest, recent, results, filters, cleanup }
  }, [largest, recent, results, filters, cleanup])

  /** What the lists were built from, so they refresh only when the index actually changed. */
  const listsFor = useRef<number | null>(null)

  const refreshLists = useCallback(async (): Promise<void> => {
    const api = window.api.library
    try {
      const [big, fresh] = await Promise.all([
        api.query({ ...LARGEST, limit: LIST_PAGE }),
        api.query({ ...RECENT, limit: LIST_PAGE })
      ])
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

  // Only the query lives here. Clearing happens in `updateFilters`, because setting state straight
  // away inside an effect makes React render twice for one change.
  useEffect(() => {
    if (!filtersActive(filters)) return
    let active = true
    const timer = setTimeout(() => {
      window.api.library
        .query({ ...toQuery(filters), limit: SEARCH_PAGE })
        .then((page) => {
          if (active) setResults(page)
        })
        .catch((caught: unknown) => {
          if (active) setError(cleanError(caught))
        })
    }, SEARCH_DELAY_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [filters, view?.files])

  const updateFilters = useCallback((change: (current: SearchFilters) => SearchFilters): void => {
    const next = change(latest.current.filters)
    latest.current = { ...latest.current, filters: next }
    setFilters(next)
    // Nothing left to narrow by, so the default lists come back straight away.
    if (!filtersActive(next)) setResults(null)
  }, [])

  const actions = useMemo<LibraryActions>(() => {
    const api = window.api.library
    const run = (task: () => Promise<unknown>): void => {
      setError(null)
      task().catch((caught: unknown) => setError(cleanError(caught)))
    }

    /** Fetches the page after what is showing and appends it, keeping the store's total. */
    const more = (
      base: LibraryFileQuery,
      current: LibraryFilePage | null,
      pageSize: number,
      apply: (update: (previous: LibraryFilePage) => LibraryFilePage) => void
    ): void => {
      if (current === null || current.rows.length >= current.total) return
      const offset = current.rows.length
      run(async () => {
        const next = await api.query({ ...base, offset, limit: pageSize })
        apply((previous) => ({ rows: [...previous.rows, ...next.rows], total: next.total }))
      })
    }

    return {
      chooseRoot: () => run(() => api.chooseRoot()),
      removeRoot: (path) => run(() => api.removeRoot(path)),
      chooseExcluded: () => run(() => api.chooseExcluded()),
      removeExcluded: (path) => run(() => api.removeExcluded(path)),
      scan: () => run(() => api.scan()),
      cancelScan: () => run(() => api.cancelScan()),
      scanRoot: (path) => run(() => api.scanRoot(path)),
      setTerm: (term) => updateFilters((current) => ({ ...current, term })),
      toggleCategory: (category) =>
        updateFilters((current) => ({
          ...current,
          categories: current.categories.includes(category)
            ? current.categories.filter((entry) => entry !== category)
            : [...current.categories, category]
        })),
      setDrive: (drive) => updateFilters((current) => ({ ...current, drive })),
      setMinSize: (minSize) => updateFilters((current) => ({ ...current, minSize })),
      setSort: (sort) =>
        updateFilters((current) => ({
          ...current,
          sort,
          direction: sort === 'name' ? 'asc' : 'desc'
        })),
      toggleDirection: () =>
        updateFilters((current) => ({
          ...current,
          direction: current.direction === 'asc' ? 'desc' : 'asc'
        })),
      clearFilters: () => updateFilters(() => EMPTY_FILTERS),
      showMoreResults: () =>
        more(toQuery(latest.current.filters), latest.current.results, SEARCH_PAGE, (update) =>
          setResults((previous) => (previous === null ? previous : update(previous)))
        ),
      showMoreLargest: () => more(LARGEST, latest.current.largest, LIST_PAGE, setLargest),
      showMoreRecent: () => more(RECENT, latest.current.recent, LIST_PAGE, setRecent),
      openFile: (path) => run(() => api.openFile(path)),
      showInFolder: (path) => run(() => api.showInFolder(path)),
      loadCleanup: () =>
        run(async () => {
          const [folders, duplicates, stale] = await Promise.all([
            api.biggestFolders(FOLDER_PAGE),
            api.duplicates(DUPLICATE_PAGE),
            api.notTouched(STALE_DAYS, 10)
          ])
          // Fingerprints belong to the groups they were taken from, so they start again here.
          setCleanup({
            loaded: true,
            folders,
            duplicates,
            stale,
            checked: {},
            checking: null,
            folderLimit: FOLDER_PAGE,
            duplicateLimit: DUPLICATE_PAGE
          })
        }),
      showMoreFolders: () =>
        run(async () => {
          const limit = latest.current.cleanup.folderLimit + FOLDER_PAGE
          const folders = await api.biggestFolders(limit)
          setCleanup((current) => ({ ...current, folders, folderLimit: limit }))
        }),
      showMoreDuplicates: () =>
        run(async () => {
          const limit = latest.current.cleanup.duplicateLimit + DUPLICATE_PAGE
          const duplicates = await api.duplicates(limit)
          // Fingerprints are keyed by group, so checks already made still apply.
          setCleanup((current) => ({ ...current, duplicates, duplicateLimit: limit }))
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
  }, [updateFilters])

  return { view, largest, recent, results, filters, error, cleanup, actions }
}
