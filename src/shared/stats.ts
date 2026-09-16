/**
 * The stats and favorites contract, shared like `shuffler.ts` and `library.ts`. The renderer
 * imports only types; main and preload use the channel names.
 */
import type { LibraryFile } from './library'

export const STATS_CHANNELS = {
  getView: 'stats:get-view',
  addFavorite: 'stats:add-favorite',
  removeFavorite: 'stats:remove-favorite',
  /** Main → renderer: a new `StatsView`. */
  view: 'stats:view'
} as const

export interface StatsTotals {
  /** Times the player confirmed a file opened. */
  plays: number
  /** Of those, how many played to the end instead of being skipped. */
  finished: number
  /** Different files played. */
  files: number
  /** When play history starts, or null if nothing has played yet. */
  since: number | null
}

export interface StatsPlayed {
  path: string
  name: string
  folder: string
  plays: number
  finished: number
  lastPlayedAt: number
}

export interface StatsFavorite {
  path: string
  name: string
  folder: string
  addedAt: number
}

export interface StatsView {
  totals: StatsTotals
  mostPlayed: StatsPlayed[]
  recentlyPlayed: StatsPlayed[]
  /** Indexed videos with no play on record. */
  neverPlayed: LibraryFile[]
  favorites: StatsFavorite[]
  lastError: string | null
}

/** What the preload bridge exposes to the renderer as `window.api.stats`. */
export interface StatsApi {
  getView(): Promise<StatsView>
  /** Stars a file the app already knows, from the index or play history. */
  addFavorite(path: string): Promise<StatsView>
  removeFavorite(path: string): Promise<StatsView>
  onView(listener: (view: StatsView) => void): () => void
}
