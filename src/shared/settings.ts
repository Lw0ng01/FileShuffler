/**
 * The Settings contract, shared like the other areas. The renderer imports only types and the list
 * of clearable data; main and preload use the channel names.
 */

export const SETTINGS_CHANNELS = {
  getView: 'settings:get-view',
  chooseMpv: 'settings:choose-mpv',
  useDefaultMpv: 'settings:use-default-mpv',
  testMpv: 'settings:test-mpv',
  setAppearance: 'settings:set-appearance',
  setPlayer: 'settings:set-player',
  clearData: 'settings:clear-data',
  /** Main → renderer: a new `SettingsView`. */
  view: 'settings:view'
} as const

/** Where the mpv the app will use came from (PROJECT.md §4). */
export type MpvSource = 'environment' | 'settings' | 'bundled' | 'installed' | 'path'

/**
 * Which theme the app uses. `system` follows the desktop, which is the default and what the app did
 * before this existed; the other two override it, so the look can be checked without changing the
 * whole computer's appearance.
 */
export type Appearance = 'system' | 'light' | 'dark'

export const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark']

/**
 * Which player a shuffle uses (PROJECT.md §4). `builtin` plays inside the app; `mpv` opens the
 * separate mpv window, which is what the app did before and is kept as the way back - and as the
 * answer for the few files Chromium cannot decode.
 */
export type PlayerChoice = 'builtin' | 'mpv'

export const PLAYER_CHOICES: readonly PlayerChoice[] = ['builtin', 'mpv']

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
  appearance: Appearance
  /** Which player a shuffle starts. mpv's settings above only matter when this is `mpv`. */
  player: PlayerChoice
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
  /** Follows the desktop, or overrides it with light or dark. */
  setAppearance(value: Appearance): Promise<SettingsView>
  /** Chooses the player the next shuffle starts. Takes effect without a restart. */
  setPlayer(value: PlayerChoice): Promise<SettingsView>
  clearData(what: ClearableData): Promise<SettingsView>
  onView(listener: (view: SettingsView) => void): () => void
}
