import { join } from 'node:path'
import type { ShufflerStatus, ShufflerView, UndoResult } from '../../shared/shuffler'
import { ShuffleSession, type RandomSource, type ShuffleSnapshot } from '../domain/shuffle'
import type { FileIdentity } from '../files/fileIdentity'
import type { ProgressSource } from '../files/progressStore'
import type { PlaybackAdapter } from '../playback/types'
import { ShuffleCoordinator, type CoordinatorState, type PlayHistory } from './coordinator'

export interface ShufflerServiceDeps {
  /** Shows the folder picker. Resolves null when cancelled. */
  pickFolder: () => Promise<string | null>
  listVideos: (folder: string) => Promise<string[]>
  launchPlayer: () => Promise<PlaybackAdapter>
  trash: (path: string) => Promise<void>
  identify: (path: string) => Promise<FileIdentity | null>
  /** Key labels bound inside the player window, shown in the UI. */
  playerKeys: ShufflerView['playerKeys']
  /** Remembers where each folder's cycle got to, so closing the app doesn't restart it. */
  progress?: ProgressSource
  /** Records what really played, for stats. */
  plays?: PlayRecorder
  random?: RandomSource
  undoWindowMs?: number
}

/** Where play history is kept. Receives full paths, unlike the coordinator. */
export interface PlayRecorder {
  opened(path: string, name: string, folder: string): void
  finished(path: string): void
}

const RECENT_LIMIT = 6
/** Progress is saved this long after the last change, so a burst of Next presses writes once. */
const SAVE_DELAY_MS = 1000

/**
 * Owns one shuffle session at a time: the chosen folder, the shuffle, the coordinator and the
 * player process. The Electron layer only forwards commands here and sends views to the window,
 * so this stays testable without Electron.
 */
export class ShufflerService {
  private readonly deps: ShufflerServiceDeps
  private readonly listeners = new Set<(view: ShufflerView) => void>()
  private folder: string | null = null
  private session: ShuffleSession | null = null
  private coordinator: ShuffleCoordinator | null = null
  private player: PlaybackAdapter | null = null
  private starting: Promise<void> | null = null
  private startingPlayer = false
  private recent: string[] = []
  private error: string | null = null
  private disposed = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(deps: ShufflerServiceDeps) {
    this.deps = deps
  }

  getView(): ShufflerView {
    const state = this.coordinator?.getState() ?? null
    const stats = state?.stats ?? this.session?.stats() ?? null
    const pendingDeletes = state?.pendingDeletes ?? []
    return {
      folder: this.folder,
      status: this.status(state),
      current: state?.current ?? null,
      cycle: stats?.cycle ?? 0,
      total: stats?.total ?? 0,
      opened: stats?.opened ?? 0,
      failed: stats?.failed ?? 0,
      recent: this.recent.filter((id) => !pendingDeletes.some((entry) => entry.id === id)),
      pendingDeletes,
      lastError: this.error ?? state?.lastError ?? null,
      playerKeys: this.deps.playerKeys
    }
  }

  onView(listener: (view: ShufflerView) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Opens the folder picker and, unless cancelled, starts a new session for that folder. */
  async chooseFolder(): Promise<ShufflerView> {
    if (this.refuseFolderChange()) return this.getView()
    const folder = await this.deps.pickFolder()
    if (folder === null || this.disposed) return this.getView()
    // A delete could have started from the player window while the picker was open.
    if (this.refuseFolderChange()) return this.getView()

    let names: string[]
    try {
      names = await this.deps.listVideos(folder)
    } catch (error) {
      this.error = `Could not read ${folder}: ${errorMessage(error)}`
      this.emit()
      return this.getView()
    }

    await this.saveProgress()
    await this.closeSession()
    if (this.disposed) return this.getView()
    this.folder = folder
    this.session = new ShuffleSession(names, {
      random: this.deps.random,
      restore: (await this.readProgress(folder)) ?? undefined
    })
    this.recent = []
    this.error = null
    // Records this as the folder to reopen next launch, even if nothing plays yet.
    this.scheduleSave()
    this.emit()
    return this.getView()
  }

  /**
   * Reopens the folder from last time, ready to play where its cycle left off (PROJECT.md §3).
   * Called at startup. Does nothing if there is no saved folder or it can't be read now, for
   * example because the drive is unplugged.
   */
  async restoreLastSession(): Promise<void> {
    if (this.session !== null || this.disposed) return
    let folder: string | null
    try {
      folder = (await this.deps.progress?.lastFolder()) ?? null
    } catch {
      return
    }
    if (folder === null) return

    let names: string[]
    try {
      names = await this.deps.listVideos(folder)
    } catch {
      return
    }
    // chooseFolder may have won the race while this was reading.
    if (this.session !== null || this.disposed) return

    this.folder = folder
    this.session = new ShuffleSession(names, {
      random: this.deps.random,
      restore: (await this.readProgress(folder)) ?? undefined
    })
    this.emit()
  }

  /**
   * Reshuffles everything and starts a new cycle, discarding this cycle's coverage (PROJECT.md §3).
   * Whatever is playing keeps playing; the next video comes from the new order.
   */
  async restartCycle(): Promise<void> {
    if (this.session === null) return
    this.session.restartCycle()
    this.cancelScheduledSave()
    await this.saveProgress()
    this.emit()
  }

  /** Starts the shuffle, or reopens the player at the current file after its window was closed. */
  async play(): Promise<void> {
    ;(await this.liveCoordinator())?.resume()
  }

  async next(): Promise<void> {
    ;(await this.liveCoordinator())?.next()
  }

  async back(): Promise<void> {
    ;(await this.liveCoordinator())?.back()
  }

  async deleteCurrent(): Promise<void> {
    const current = this.coordinator?.getState().current ?? null
    if (this.coordinator === null || current === null) return
    this.recent = this.recent.filter((id) => id !== current)
    this.coordinator.deleteCurrent()
  }

  async undoDelete(id: string): Promise<UndoResult> {
    return this.coordinator?.undoDelete(id) ?? 'unknown'
  }

  /** Closes the player and cancels deletes still in their undo window (PROJECT.md §2.3). */
  async dispose(): Promise<void> {
    this.disposed = true
    this.cancelScheduledSave()
    await this.saveProgress()
    await this.closeSession()
    this.listeners.clear()
  }

  /** Turns the coordinator's file names into full paths for the play history. */
  private playHistory(folder: string): PlayHistory | undefined {
    const plays = this.deps.plays
    if (plays === undefined) return undefined
    return {
      opened: (id) => plays.opened(join(folder, id), id, folder),
      finished: (id) => plays.finished(join(folder, id))
    }
  }

  private async readProgress(folder: string): Promise<ShuffleSnapshot | null> {
    try {
      return (await this.deps.progress?.read(folder)) ?? null
    } catch {
      // Saved progress is a convenience: never let it stop a folder from opening.
      return null
    }
  }

  private scheduleSave(): void {
    if (this.deps.progress === undefined || this.saveTimer !== null) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.saveProgress()
    }, SAVE_DELAY_MS)
    // Saving progress is never a reason to keep the process alive.
    if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref()
  }

  private cancelScheduledSave(): void {
    if (this.saveTimer === null) return
    clearTimeout(this.saveTimer)
    this.saveTimer = null
  }

  private async saveProgress(): Promise<void> {
    const store = this.deps.progress
    const folder = this.folder
    const session = this.session
    if (store === undefined || folder === null || session === null) return
    try {
      await store.save(folder, session.snapshot())
    } catch {
      // A failed save must never interrupt playback; the cycle is only a convenience.
    }
  }

  private status(state: CoordinatorState | null): ShufflerStatus {
    if (this.session === null) return 'no-folder'
    if (this.startingPlayer) return 'starting-player'
    if (state === null || state.status === 'idle') return 'ready'
    return state.status
  }

  private refuseFolderChange(): boolean {
    if ((this.coordinator?.getState().pendingDeletes.length ?? 0) === 0) return false
    this.error = 'Undo or wait for the pending delete before changing folders.'
    this.emit()
    return true
  }

  /** The coordinator with a running player, starting the player first if needed. */
  private async liveCoordinator(): Promise<ShuffleCoordinator | null> {
    if (this.session === null || this.disposed) return null
    if (!this.playerRunning()) {
      this.starting ??= this.startPlayer().finally(() => {
        this.starting = null
      })
      await this.starting
    }
    return this.playerRunning() ? this.coordinator : null
  }

  private playerRunning(): boolean {
    return this.coordinator !== null && this.coordinator.getState().status !== 'player-exited'
  }

  private async startPlayer(): Promise<void> {
    const session = this.session
    const folder = this.folder
    if (session === null || folder === null) return
    this.startingPlayer = true
    this.error = null
    this.emit()

    let player: PlaybackAdapter
    try {
      player = await this.deps.launchPlayer()
    } catch (error) {
      this.startingPlayer = false
      this.error = launchErrorMessage(error)
      this.emit()
      return
    }
    this.startingPlayer = false

    // The folder changed or the app is closing while mpv was starting.
    if (this.session !== session || this.disposed) {
      await player.dispose()
      this.emit()
      return
    }

    const previous = this.player
    this.player = player
    if (this.coordinator === null) {
      this.coordinator = new ShuffleCoordinator({
        session,
        player,
        resolvePath: (id) => join(folder, id),
        trash: this.deps.trash,
        identify: this.deps.identify,
        undoWindowMs: this.deps.undoWindowMs,
        history: this.playHistory(folder)
      })
      this.coordinator.onState((state) => this.handleState(state))
    } else {
      this.coordinator.replacePlayer(player)
    }
    if (previous !== null) void previous.dispose()
    this.emit()
  }

  private handleState(state: CoordinatorState): void {
    const current = state.current
    if (state.status === 'playing' && current !== null && this.recent[0] !== current) {
      this.recent = [current, ...this.recent.filter((id) => id !== current)].slice(0, RECENT_LIMIT)
    }
    // Playback moved on, so any earlier service message (folder or launch problem) is stale.
    this.error = null
    this.scheduleSave()
    this.emit()
  }

  private async closeSession(): Promise<void> {
    this.coordinator?.dispose()
    this.coordinator = null
    this.session = null
    this.folder = null
    const player = this.player
    this.player = null
    if (player !== null) await player.dispose()
  }

  private emit(): void {
    const view = this.getView()
    for (const listener of [...this.listeners]) listener(view)
  }
}

function launchErrorMessage(error: unknown): string {
  const message = errorMessage(error)
  if (message.includes('ENOENT')) {
    return "mpv wasn't found. Install mpv, or set FILESHUFFLER_MPV to the mpv program's path."
  }
  return `Could not start mpv: ${message}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
