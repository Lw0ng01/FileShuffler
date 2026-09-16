/**
 * The Settings contract, shared like the other areas. The renderer imports only types and the list
 * of clearable data; main and preload use the channel names.
 */

export const SETTINGS_CHANNELS = {
  getView: 'settings:get-view',
  chooseMpv: 'settings:choose-mpv',
  useDefaultMpv: 'settings:use-default-mpv',
  testMpv: 'settings:test-mpv',
  clearData: 'settings:clear-data',
  /** Main → renderer: a new `SettingsView`. */
  view: 'settings:view'
} as const

/** Where the mpv the app will use came from (PROJECT.md §4). */
export type MpvSource = 'environment' | 'settings' | 'bundled' | 'installed' | 'path'

/** What Settings can erase. Each is separate, so clearing one never costs the others. */
export type ClearableData = 'plays' | 'favorites' | 'progress' | 'index'

export const CLEARABLE_DATA: readonly ClearableData[] = ['plays', 'favorites', 'progress', 'index']

export interface MpvTest {
  ok: boolean
  /** The version line when it worked, or why it didn't. */
  message: string
  testedAt: number
}

export interface SettingsView {
  mpv: {
    /** The program a shuffle will start. */
    path: string
    source: MpvSource
    /** What was chosen in Settings, or null when mpv is found automatically. */
    chosen: string | null
    test: MpvTest | null
    testing: boolean
  }
  lastNotice: string | null
  lastError: string | null
}

/** What the preload bridge exposes to the renderer as `window.api.settings`. */
export interface SettingsApi {
  getView(): Promise<SettingsView>
  /** Opens a file picker, checks the choice is a working mpv, and only then saves it. */
  chooseMpv(): Promise<SettingsView>
  /** Forgets the chosen mpv and goes back to finding it automatically. */
  useDefaultMpv(): Promise<SettingsView>
  /** Runs the mpv a shuffle would use and reports its version. */
  testMpv(): Promise<SettingsView>
  clearData(what: ClearableData): Promise<SettingsView>
  onView(listener: (view: SettingsView) => void): () => void
}
