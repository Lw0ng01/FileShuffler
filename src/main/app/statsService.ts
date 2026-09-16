import type { LibraryFile, LibrarySort } from '../../shared/library'
import type { StatsView } from '../../shared/stats'
import type { IndexDb } from '../library/indexDb'

export interface StatsServiceDeps {
  db: IndexDb
}

/** Rows in each list. Enough to be useful without making the tab a wall of names. */
const LIST_LIMIT = 10

/**
 * Play stats and favorites (PROJECT.md §7 Phase 5). Reads play history the shuffler records and
 * the index the library builds, from the same database. Favorites are a starred list only: they
 * have no effect on the shuffle, which Lucas chose to keep purely random.
 *
 * Holds no Electron imports, like the other services, so it can be tested without a window.
 */
export class StatsService {
  private readonly deps: StatsServiceDeps
  private readonly listeners = new Set<(view: StatsView) => void>()
  private error: string | null = null

  constructor(deps: StatsServiceDeps) {
    this.deps = deps
  }

  getView(): StatsView {
    const { db } = this.deps
    return {
      totals: db.playTotals(),
      mostPlayed: db.mostPlayed(LIST_LIMIT),
      recentlyPlayed: db.recentlyPlayed(LIST_LIMIT),
      neverPlayed: db.neverPlayed(LIST_LIMIT),
      favorites: db.favorites(),
      lastError: this.error
    }
  }

  onView(listener: (view: StatsView) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Stars a file. Only a file the app already knows can be starred — from the index or from play
   * history — so the renderer can't plant arbitrary paths in the database.
   */
  addFavorite(path: string): StatsView {
    const known = this.deps.db.describeFile(path)
    if (known === null) {
      this.error = `${path} isn't in the index or play history, so it can't be a favorite.`
    } else {
      this.deps.db.addFavorite(path, known.name, known.folder)
      this.error = null
    }
    this.emit()
    return this.getView()
  }

  removeFavorite(path: string): StatsView {
    this.deps.db.removeFavorite(path)
    this.error = null
    this.emit()
    return this.getView()
  }

  /** A longer never-played list than the view carries, in the order the user picked. */
  neverPlayed(limit: number, sort: LibrarySort): LibraryFile[] {
    return this.deps.db.neverPlayed(limit, sort)
  }

  /** Something played or finished, so an open Stats tab should refresh. */
  notifyChanged(): void {
    this.emit()
  }

  private emit(): void {
    if (this.listeners.size === 0) return
    const view = this.getView()
    for (const listener of [...this.listeners]) listener(view)
  }
}
