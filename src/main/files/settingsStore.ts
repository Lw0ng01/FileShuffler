import { readFile } from 'node:fs/promises'
import { writeJsonAtomic } from './atomicJson'

/** Bumped only if the saved shape changes; an unknown version reads as the defaults. */
const VERSION = 1

export interface AppSettings {
  /** The mpv program chosen in Settings, or null to find mpv automatically (PROJECT.md §4). */
  mpvPath: string | null
}

function defaults(): AppSettings {
  return { mpvPath: null }
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
    const next: AppSettings = { ...(await this.get()), mpvPath: path }
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
      return { mpvPath: typeof mpvPath === 'string' && mpvPath.length > 0 ? mpvPath : null }
    } catch {
      return defaults()
    }
  }
}
