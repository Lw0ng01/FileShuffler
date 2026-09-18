import { readFile } from 'node:fs/promises'
import {
  APPEARANCES,
  PLAYER_CHOICES,
  type Appearance,
  type PlayerChoice
} from '../../shared/settings'
import { writeJsonAtomic } from './atomicJson'

/**
 * Bumped only if the saved shape changes; an unknown version reads as the defaults.
 *
 * Adding a field is deliberately not a shape change: a version 1 file written before `appearance`
 * existed still loads, and simply falls back to following the system. Bumping this would have
 * thrown away everyone's chosen mpv path to add one setting.
 */
const VERSION = 1

export interface AppSettings {
  /** The mpv program chosen in Settings, or null to find mpv automatically (PROJECT.md §4). */
  mpvPath: string | null
  /** Which theme to use, or `system` to follow the desktop. */
  appearance: Appearance
  /** Which player a shuffle starts (PROJECT.md §4). */
  player: PlayerChoice
}

function defaults(): AppSettings {
  return { mpvPath: null, appearance: 'system', player: 'builtin' }
}

/**
 * The user's choices from the Settings tab, in one small JSON file in the app's data folder.
 *
 * Kept apart from the index and play history on purpose: clearing data from Settings must never
 * also throw away the settings themselves. A missing or corrupt file reads as the defaults.
 */
export class SettingsStore {
  private readonly file: string
  private cache: AppSettings | null = null
  /** Writes run one at a time, so two quick changes can't interleave. */
  private writes: Promise<void> = Promise.resolve()

  constructor(file: string) {
    this.file = file
  }

  async get(): Promise<AppSettings> {
    this.cache ??= await this.read()
    return { ...this.cache }
  }

  /** Saves the chosen mpv program, or null to go back to finding it automatically. */
  async setMpvPath(path: string | null): Promise<AppSettings> {
    return this.save({ ...(await this.get()), mpvPath: path })
  }

  /** Saves the chosen theme. */
  async setAppearance(appearance: Appearance): Promise<AppSettings> {
    return this.save({ ...(await this.get()), appearance })
  }

  /** Saves which player a shuffle starts. */
  async setPlayer(player: PlayerChoice): Promise<AppSettings> {
    return this.save({ ...(await this.get()), player })
  }

  private async save(next: AppSettings): Promise<AppSettings> {
    this.cache = next
    this.writes = this.writes
      .catch(() => undefined)
      .then(() => writeJsonAtomic(this.file, { version: VERSION, ...next }))
    await this.writes
    return { ...next }
  }

  private async read(): Promise<AppSettings> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch {
      return defaults()
    }
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null) return defaults()
      const input = parsed as Record<string, unknown>
      if (input['version'] !== VERSION) return defaults()
      const mpvPath = input['mpvPath']
      const appearance = input['appearance']
      const player = input['player']
      return {
        mpvPath: typeof mpvPath === 'string' && mpvPath.length > 0 ? mpvPath : null,
        // Absent in files written before this setting existed, and anything unrecognised is
        // treated the same way: follow the system.
        appearance: APPEARANCES.includes(appearance as Appearance)
          ? (appearance as Appearance)
          : 'system',
        // Absent in files written before the built-in player existed, and that means the built-in
        // one. Keeping upgrades on mpv was tried and was exactly wrong (Lucas, 2026-09-17): the
        // whole point of the built-in player is not to see mpv's window, so defaulting to mpv made
        // the feature look like it had not shipped. Anyone who wants mpv can choose it in Settings.
        player: PLAYER_CHOICES.includes(player as PlayerChoice)
          ? (player as PlayerChoice)
          : 'builtin'
      }
    } catch {
      return defaults()
    }
  }
}
