import type { Appearance, ClearableData, PlayerChoice, SettingsView } from '../../shared/settings'
import type { AppSettings } from '../files/settingsStore'
import type { MpvLocation } from '../playback/mpv/findMpv'
import type { MpvProbe } from '../playback/mpv/probeMpv'

/** The part of `SettingsStore` this needs, so tests can pass a fake. */
export interface SettingsSource {
  get(): Promise<AppSettings>
  setMpvPath(path: string | null): Promise<AppSettings>
  setAppearance(value: Appearance): Promise<AppSettings>
  setPlayer(value: PlayerChoice): Promise<AppSettings>
}

export interface SettingsServiceDeps {
  store: SettingsSource
  /** Where mpv would be found, given what (if anything) was chosen in Settings. */
  locate: (chosen: string | null) => MpvLocation
  /** Runs a program with `--version` to check it is a working mpv. */
  probe: (path: string) => Promise<MpvProbe>
  /** The system's file picker, for choosing the mpv program. Resolves null when cancelled. */
  pickProgram: () => Promise<string | null>
  /** One eraser per kind of data. Each touches only its own data. */
  clear: Record<ClearableData, () => Promise<void> | void>
  /** Clearing the index while a scan writes to it would leave a half-rebuilt index. */
  isScanning: () => boolean
  /**
   * Puts the chosen theme into effect. Injected so this service keeps no Electron import: in the
   * app it sets `nativeTheme.themeSource`, which also decides what `prefers-color-scheme` reports
   * to the page, so the whole UI follows without the renderer knowing anything about it.
   */
  applyAppearance?: (value: Appearance) => void
  now?: () => number
}

const CLEARED: Record<ClearableData, string> = {
  plays: 'Play history cleared.',
  favorites: 'Favorites cleared.',
  progress:
    'Saved shuffle progress cleared. A folder that is open now saves its place again as you keep watching.',
  index: 'Index cleared. Your folders are still listed, so scan to rebuild it.'
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The Settings tab (PROJECT.md §6 Settings): which mpv a shuffle starts, and erasing personal data.
 * No Electron imports, like the other services, so it can be tested without a window.
 *
 * A chosen mpv is tested before it is saved, so a wrong pick is caught here with a clear reason,
 * not later as a shuffle that won't start.
 */
export class SettingsService {
  private readonly deps: SettingsServiceDeps
  private readonly listeners = new Set<(view: SettingsView) => void>()
  private chosen: string | null = null
  private appearance: Appearance = 'system'
  private player: PlayerChoice = 'builtin'
  private test: SettingsView['mpv']['test'] = null
  private testing = false
  private notice: string | null = null
  private error: string | null = null

  constructor(deps: SettingsServiceDeps) {
    this.deps = deps
  }

  /** Reads saved settings. Called once at startup. */
  async load(): Promise<void> {
    const saved = await this.deps.store.get()
    this.chosen = saved.mpvPath
    this.appearance = saved.appearance
    this.player = saved.player
    // Put the saved theme into effect at startup, or the choice would only survive until restart.
    this.deps.applyAppearance?.(this.appearance)
    this.emit()
  }

  getView(): SettingsView {
    const location = this.deps.locate(this.chosen)
    return {
      mpv: {
        path: location.path,
        source: location.source,
        chosen: this.chosen,
        test: this.test,
        testing: this.testing
      },
      appearance: this.appearance,
      player: this.player,
      lastNotice: this.notice,
      lastError: this.error
    }
  }

  /** Follows the desktop, or overrides it with light or dark. Saved, so it survives a restart. */
  async setAppearance(value: Appearance): Promise<SettingsView> {
    this.reset()
    await this.deps.store.setAppearance(value)
    this.appearance = value
    this.deps.applyAppearance?.(value)
    this.emit()
    return this.getView()
  }

  /**
   * Chooses the player the next shuffle starts. Saved, so it survives a restart, and read at every
   * launch rather than cached, so the choice applies without restarting the app.
   */
  async setPlayer(value: PlayerChoice): Promise<SettingsView> {
    this.reset()
    await this.deps.store.setPlayer(value)
    this.player = value
    this.emit()
    return this.getView()
  }

  onView(listener: (view: SettingsView) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async chooseMpv(): Promise<SettingsView> {
    const picked = await this.deps.pickProgram()
    if (picked === null) return this.getView()

    this.reset()
    const result = await this.deps.probe(picked)
    if (!result.ok) {
      // Not saved: keeping a program that can't play would only fail again at the next shuffle.
      this.error = `That can't be used as mpv: ${result.reason}`
      this.emit()
      return this.getView()
    }
    await this.deps.store.setMpvPath(picked)
    this.chosen = picked
    this.test = { ok: true, message: result.version, testedAt: this.now() }
    this.notice = `Shuffles will use ${result.version}.`
    this.emit()
    return this.getView()
  }

  async useDefaultMpv(): Promise<SettingsView> {
    this.reset()
    await this.deps.store.setMpvPath(null)
    this.chosen = null
    this.test = null
    this.notice = 'FileShuffler will find mpv by itself again.'
    this.emit()
    return this.getView()
  }

  /** Tries the mpv a shuffle would actually start, wherever it came from. */
  async testMpv(): Promise<SettingsView> {
    if (this.testing) return this.getView()
    this.reset()
    this.testing = true
    this.emit()
    const { path } = this.deps.locate(this.chosen)
    const result = await this.deps.probe(path)
    this.testing = false
    this.test = result.ok
      ? { ok: true, message: result.version, testedAt: this.now() }
      : { ok: false, message: result.reason, testedAt: this.now() }
    this.emit()
    return this.getView()
  }

  async clearData(what: ClearableData): Promise<SettingsView> {
    this.reset()
    if (what === 'index' && this.deps.isScanning()) {
      this.error = 'Stop the scan before clearing the index.'
      this.emit()
      return this.getView()
    }
    try {
      await this.deps.clear[what]()
      this.notice = CLEARED[what]
    } catch (error) {
      this.error = `Could not clear that: ${message(error)}`
    }
    this.emit()
    return this.getView()
  }

  private reset(): void {
    this.notice = null
    this.error = null
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private emit(): void {
    const view = this.getView()
    for (const listener of [...this.listeners]) listener(view)
  }
}
