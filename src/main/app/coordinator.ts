import type { ShuffleSession, ShuffleStats } from '../domain/shuffle'
import type { PlaybackAdapter, PlaybackEvent } from '../playback/types'

/**
 * - `idle`: nothing requested yet
 * - `loading`: a file was sent to the player, waiting for it to open
 * - `playing`: the player confirmed the current file opened
 * - `finished`: nothing left that can play (empty folder, or every file failed)
 * - `player-exited`: the player is gone; commands are ignored until a new coordinator is created
 */
export type CoordinatorStatus = 'idle' | 'loading' | 'playing' | 'finished' | 'player-exited'

export interface CoordinatorState {
  status: CoordinatorStatus
  current: string | null
  stats: ShuffleStats
  /** Most recent problem, kept until the next file opens successfully. */
  lastError: string | null
}

export interface CoordinatorOptions {
  session: ShuffleSession
  player: PlaybackAdapter
  /** Maps a session item ID to the absolute path the player should open. */
  resolvePath: (id: string) => string
}

/**
 * The single authority for a shuffle session's playback (PROJECT.md §5). Every navigation command
 * and player event goes through here, and each load carries a token, so rapid commands and late
 * player events can never advance twice or overwrite newer state.
 */
export class ShuffleCoordinator {
  private readonly session: ShuffleSession
  private readonly player: PlaybackAdapter
  private readonly resolvePath: (id: string) => string
  private readonly listeners = new Set<(state: CoordinatorState) => void>()
  private readonly stopListening: () => void
  private status: CoordinatorStatus = 'idle'
  private current: string | null = null
  private activeToken: number | null = null
  private lastError: string | null = null

  constructor(options: CoordinatorOptions) {
    this.session = options.session
    this.player = options.player
    this.resolvePath = options.resolvePath
    this.stopListening = this.player.onEvent((event) => this.handle(event))
  }

  getState(): CoordinatorState {
    return {
      status: this.status,
      current: this.current,
      stats: this.session.stats(),
      lastError: this.lastError
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

  /** Stops reacting to the player. The owner disposes the player itself. */
  dispose(): void {
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
    this.player.unload().catch((error: unknown) => {
      this.lastError = `Could not stop the player: ${String(error)}`
      this.emit()
    })
  }

  private handle(event: PlaybackEvent): void {
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
        else this.back()
        return
      case 'exited':
        this.activeToken = null
        this.status = 'player-exited'
        this.lastError = `Player exited: ${event.reason}`
        this.emit()
        return
    }
  }

  private emit(): void {
    const state = this.getState()
    for (const listener of this.listeners) listener(state)
  }
}
