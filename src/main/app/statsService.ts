import type { LibraryFile, LibrarySort } from '../../shared/library'
import type { StatsView } from '../../shared/stats'
import type { IndexStore } from '../library/indexStore'

export interface StatsServiceDeps {
  /** The index and play history, answered by a worker thread in the app. */
  db: IndexStore
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
  /** Views finish out of order sometimes; an older one never replaces a newer one. */
  private viewsStarted = 0
  private viewsSent = 0

  constructor(deps: StatsServiceDeps) {
    this.deps = deps
  }

  async getView(): Promise<StatsView> {
    const { db } = this.deps
    const [totals, mostPlayed, recentlyPlayed, neverPlayed, favorites] = await Promise.all([
      db.playTotals(),
      db.mostPlayed(LIST_LIMIT),
      db.recentlyPlayed(LIST_LIMIT),
      db.neverPlayed(LIST_LIMIT),
      db.favorites()
    ])
    return { totals, mostPlayed, recentlyPlayed, neverPlayed, favorites, lastError: this.error }
  }

  onView(listener: (view: StatsView) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Stars a file. Only a file the app already knows can be starred — from the index or from play
   * history — so the renderer can't plant arbitrary paths in the database.
   */
  async addFavorite(path: string): Promise<StatsView> {
    const known = await this.deps.db.describeFile(path)
    if (known === null) {
      this.error = `${path} isn't in the index or play history, so it can't be a favorite.`
    } else {
      await this.deps.db.addFavorite(path, known.name, known.folder)
      this.error = null
    }
    return this.publish()
  }

  async removeFavorite(path: string): Promise<StatsView> {
    await this.deps.db.removeFavorite(path)
    this.error = null
    return this.publish()
  }

  /** A longer never-played list than the view carries, in the order the user picked. */
  neverPlayed(limit: number, sort: LibrarySort): Promise<LibraryFile[]> {
    return this.deps.db.neverPlayed(limit, sort)
  }

  /** Something played or finished, so an open Stats tab should refresh. */
  async notifyChanged(): Promise<void> {
    if (this.listeners.size === 0) return
    await this.publish()
  }

  private async publish(): Promise<StatsView> {
    const number = ++this.viewsStarted
    const view = await this.getView()
    if (number > this.viewsSent) {
      this.viewsSent = number
      for (const listener of [...this.listeners]) listener(view)
    }
    return view
  }
}
