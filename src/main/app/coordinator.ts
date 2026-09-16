import type { UndoResult } from '../../shared/shuffler'
import type { ShuffleSession, ShuffleStats } from '../domain/shuffle'
import { sameFile, type FileIdentity } from '../files/fileIdentity'
import type { PlaybackAdapter, PlaybackEvent } from '../playback/types'

/**
 * - `idle`: nothing requested yet
 * - `loading`: a file was sent to the player, waiting for it to open
 * - `playing`: the player confirmed the current file opened
 * - `finished`: nothing left that can play (empty folder, or every file failed or was deleted)
 * - `player-exited`: the player is gone; navigation is ignored until a new coordinator is created
 */
export type CoordinatorStatus = 'idle' | 'loading' | 'playing' | 'finished' | 'player-exited'

export interface PendingDelete {
  id: string
  /** When the undo window ends, in milliseconds since the epoch. */
  deadline: number
}

export interface CoordinatorState {
  status: CoordinatorStatus
  current: string | null
  stats: ShuffleStats
  /** Most recent problem, kept until the next file opens successfully. */
  lastError: string | null
  /** Deletes that can still be undone. */
  pendingDeletes: PendingDelete[]
}

export interface CoordinatorOptions {
  session: ShuffleSession
  player: PlaybackAdapter
  /** Maps a session item ID to the absolute path the player should open. */
  resolvePath: (id: string) => string
  /** Moves a file to the OS trash. Must reject, never delete permanently, if that isn't possible. */
  trash: (path: string) => Promise<void>
  /** The identity of the file at a path, or null if nothing is there. Rejects if it can't tell. */
  identify: (path: string) => Promise<FileIdentity | null>
  /** How long a delete can be undone before the file is trashed. */
  undoWindowMs?: number
}

const DEFAULT_UNDO_WINDOW_MS = 5000
/** If the player still holds a file when its undo window ends, check again this often... */
const RELEASE_RETRY_MS = 1000
/** ...up to this many times, then keep the file rather than trash it while it's open. */
const MAX_RELEASE_RETRIES = 10

interface DeleteInProgress {
  id: string
  path: string
  deadline: number
  timer: ReturnType<typeof setTimeout>
  /** Identity when the delete started; undefined if it couldn't be read. */
  identity: Promise<FileIdentity | null | undefined>
  /** The load that was showing this file when the delete started. */
  token: number | null
  /** True once the player has moved past that load or stopped. */
  released: boolean
  releaseRetries: number
  /** The trash step has begun and can no longer be undone. */
  trashing: boolean
}

/**
 * The single authority for a shuffle session's playback and deletes (PROJECT.md §5). Every command
 * and player event goes through here, and each load carries a token, so rapid commands and late
 * player events can never advance twice or overwrite newer state.
 */
export class ShuffleCoordinator {
  private readonly session: ShuffleSession
  private player: PlaybackAdapter
  private readonly resolvePath: (id: string) => string
  private readonly trash: (path: string) => Promise<void>
  private readonly identify: (path: string) => Promise<FileIdentity | null>
  private readonly undoWindowMs: number
  private readonly listeners = new Set<(state: CoordinatorState) => void>()
  private readonly deletes = new Map<string, DeleteInProgress>()
  private stopListening: () => void
  private status: CoordinatorStatus = 'idle'
  private current: string | null = null
  private activeToken: number | null = null
  private lastError: string | null = null

  constructor(options: CoordinatorOptions) {
    this.session = options.session
    this.player = options.player
    this.resolvePath = options.resolvePath
    this.trash = options.trash
    this.identify = options.identify
    this.undoWindowMs = options.undoWindowMs ?? DEFAULT_UNDO_WINDOW_MS
    this.stopListening = this.player.onEvent((event) => this.handle(event))
  }

  getState(): CoordinatorState {
    return {
      status: this.status,
      current: this.current,
      stats: this.session.stats(),
      lastError: this.lastError,
      pendingDeletes: [...this.deletes.values()]
        .filter((entry) => !entry.trashing)
        .map((entry) => ({ id: entry.id, deadline: entry.deadline }))
    }
  }

  onState(listener: (state: CoordinatorState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  next(): void {
    if (this.status === 'player-exited') return
    this.show(this.session.next())
  }

  /** At the start of history this keeps the current file playing instead of reloading it. */
  back(): void {
    if (this.status === 'player-exited') return
    const id = this.session.back()
    if (id !== null) this.show(id)
  }

  /**
   * Starts the shuffle if nothing has played yet or it finished, or reopens the current file
   * after `replacePlayer`. Does nothing while a file is loading or playing.
   */
  resume(): void {
    if (this.status === 'idle' && this.current !== null) this.show(this.current)
    else if (this.status === 'idle' || this.status === 'finished') this.next()
  }

  /**
   * Connects a new player after the previous one exited (for example the user closed the mpv
   * window). Playback waits for `resume()` or a navigation command. Pending deletes carry over:
   * the old player is gone, so it no longer holds any file.
   */
  replacePlayer(player: PlaybackAdapter): void {
    if (this.status !== 'player-exited') {
      throw new Error('Only a player that has exited can be replaced')
    }
    this.stopListening()
    this.player = player
    this.stopListening = player.onEvent((event) => this.handle(event))
    this.activeToken = null
    this.status = 'idle'
    this.lastError = null
    this.emit()
  }

  /**
   * Deletes the current file with an undo window (PROJECT.md §2.2–2.3): hides it, moves on, and
   * sends it to the trash only when the window ends and the file is confirmed unchanged.
   */
  deleteCurrent(): void {
    const id = this.current
    if (id === null || this.deletes.has(id)) return
    const path = this.resolvePath(id)
    this.deletes.set(id, {
      id,
      path,
      deadline: Date.now() + this.undoWindowMs,
      timer: setTimeout(() => void this.finishDelete(id), this.undoWindowMs),
      identity: this.identify(path).catch(() => undefined),
      token: this.activeToken,
      released: this.activeToken === null,
      releaseRetries: 0,
      trashing: false
    })
    this.session.beginDelete(id)
    if (this.status === 'player-exited') this.emit()
    else this.next()
  }

  /**
   * Cancels a delete that is still in its undo window, making the file playable again, and says
   * what happened so the UI can confirm it. Once the trash step has begun it can't be stopped
   * (PROJECT.md §2.3), and an unknown name was already trashed or kept.
   */
  undoDelete(id: string): UndoResult {
    const entry = this.deletes.get(id)
    if (entry === undefined) return 'unknown'
    if (entry.trashing) return 'trashing'
    clearTimeout(entry.timer)
    this.deletes.delete(id)
    this.session.cancelDelete(id)
    this.emit()
    return 'restored'
  }

  /**
   * Stops reacting to the player and cancels deletes still in their undo window; they are never
   * replayed later. A trash operation that already started can't be cancelled and finishes on its
   * own. The owner disposes the player itself.
   */
  dispose(): void {
    for (const entry of [...this.deletes.values()]) {
      if (entry.trashing) continue
      clearTimeout(entry.timer)
      this.deletes.delete(entry.id)
      this.session.cancelDelete(entry.id)
    }
    this.stopListening()
    this.listeners.clear()
  }

  private show(id: string | null): void {
    if (id === null) {
      this.finish()
      return
    }
    this.current = id
    this.status = 'loading'
    this.activeToken = this.player.load(this.resolvePath(id))
    this.emit()
  }

  private finish(): void {
    this.activeToken = null
    this.current = null
    this.status = 'finished'
    this.emit()
    this.player.unload().then(
      () => this.releaseAll(),
      (error: unknown) => {
        this.lastError = `Could not stop the player: ${errorMessage(error)}`
        this.emit()
      }
    )
  }

  private handle(event: PlaybackEvent): void {
    if ('token' in event) this.releaseOlderThan(event.token)

    switch (event.type) {
      case 'loaded':
        if (event.token !== this.activeToken || this.current === null) return
        this.session.markOpened(this.current)
        this.status = 'playing'
        this.lastError = null
        this.emit()
        return
      case 'ended':
        if (event.token !== this.activeToken) return
        this.next()
        return
      case 'failed':
        if (event.token !== this.activeToken || this.current === null) return
        this.session.markFailed(this.current)
        this.lastError = `Could not play ${this.current}: ${event.reason}`
        this.next()
        return
      case 'command':
        if (event.command === 'next') this.next()
        else if (event.command === 'back') this.back()
        else this.deleteCurrent()
        return
      case 'exited':
        this.activeToken = null
        this.releaseAll()
        this.status = 'player-exited'
        this.lastError = `Player exited: ${event.reason}`
        this.emit()
        return
    }
  }

  /** Any event for a newer load means the player has already closed the older file. */
  private releaseOlderThan(token: number): void {
    for (const entry of this.deletes.values()) {
      if (entry.token === null || token > entry.token) entry.released = true
    }
  }

  private releaseAll(): void {
    for (const entry of this.deletes.values()) entry.released = true
  }

  private async finishDelete(id: string): Promise<void> {
    const entry = this.deletes.get(id)
    if (entry === undefined || entry.trashing) return

    if (!entry.released) {
      if (entry.releaseRetries >= MAX_RELEASE_RETRIES) {
        this.abandonDelete(entry, `${id} is still open in the player, so it was not deleted`)
        return
      }
      entry.releaseRetries += 1
      entry.timer = setTimeout(() => void this.finishDelete(id), RELEASE_RETRY_MS)
      return
    }

    entry.trashing = true
    this.emit()

    const original = await entry.identity
    let now: FileIdentity | null
    try {
      now = await this.identify(entry.path)
    } catch (error) {
      this.abandonDelete(entry, `Could not check ${id} before deleting it: ${errorMessage(error)}`)
      return
    }

    if (now === null) {
      // Already gone: nothing to trash, so just forget it.
      this.completeDelete(entry)
      return
    }
    if (original === undefined || original === null || !sameFile(original, now)) {
      this.abandonDelete(entry, `${id} could not be confirmed as the same file, so it was kept`)
      return
    }

    try {
      await this.trash(entry.path)
    } catch (error) {
      this.abandonDelete(entry, `Could not move ${id} to the trash: ${errorMessage(error)}`)
      return
    }
    this.completeDelete(entry)
  }

  private completeDelete(entry: DeleteInProgress): void {
    this.deletes.delete(entry.id)
    this.session.completeDelete(entry.id)
    this.emit()
  }

  /** Keeps the file: it becomes playable again and the reason is shown. */
  private abandonDelete(entry: DeleteInProgress, reason: string): void {
    clearTimeout(entry.timer)
    this.deletes.delete(entry.id)
    this.session.cancelDelete(entry.id)
    this.lastError = reason
    this.emit()
  }

  private emit(): void {
    const state = this.getState()
    for (const listener of this.listeners) listener(state)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
