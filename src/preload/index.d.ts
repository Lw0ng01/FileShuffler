import type { LibraryApi } from '../shared/library'
import type { ShufflerApi } from '../shared/shuffler'

declare global {
  interface Window {
    /** Exposed by src/preload/index.ts. */
    api: {
      shuffler: ShufflerApi
      library: LibraryApi
    }
  }
}

export {}
