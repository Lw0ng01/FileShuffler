import type { LibraryApi } from '../shared/library'
import type { ShufflerApi } from '../shared/shuffler'
import type { StatsApi } from '../shared/stats'

declare global {
  interface Window {
    /** Exposed by src/preload/index.ts. */
    api: {
      shuffler: ShufflerApi
      library: LibraryApi
      stats: StatsApi
    }
  }
}

export {}
