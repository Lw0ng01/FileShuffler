import type { LibraryApi } from '../shared/library'
import type { PlayerApi } from '../shared/player'
import type { ShufflerApi } from '../shared/shuffler'
import type { SettingsApi } from '../shared/settings'
import type { StatsApi } from '../shared/stats'

declare global {
  interface Window {
    /** Exposed by src/preload/index.ts. */
    api: {
      shuffler: ShufflerApi
      library: LibraryApi
      stats: StatsApi
      settings: SettingsApi
      /** Belongs to the video surface, not to the screens (src/shared/player.ts). */
      player: PlayerApi
    }
  }
}

export {}
