import type { PlayerCommandMessage, PlayerEventMessage } from '../../../shared/player'
import type { PlaybackAdapter, PlaybackEvent } from '../types'

/**
 * The main-process half of the built-in player (PROJECT.md §4). The video element lives in the
 * renderer; this keeps the application's view of playback exactly as it is for mpv, so the
 * coordinator, the shuffle and the delete flow do not know the difference.
 *
 * Deliberately knows nothing about Electron: it talks through `PlayerTransport`, which the IPC
 * layer implements and the tests fake. The same shape as the mpv adapter, for the same reason.
 */

/** How the adapter reaches the renderer. One implementation for Electron, one for tests. */
export interface PlayerTransport {
  /** True while a renderer is there to receive commands. */
  isLive(): boolean
  send(command: PlayerCommandMessage): void
  onMessage(listener: (message: PlayerEventMessage) => void): () => void
  /** Called when a load starts, so the streaming scheme knows which file the token refers to. */
  setSource(token: number, path: string): void
  /** Called on dispose, so no token keeps pointing at a file after the session ends. */
  clearSources(): void
}

export interface EmbeddedPlayerOptions {
  transport: PlayerTransport
  /**
   * How long to wait for the renderer to confirm it has let go of the file. The delete flow waits
   * on this, so it must fail open rather than hang: a page that never answers must not be able to
   * stall a trash operation forever (PROJECT.md §2).
   */
  unloadTimeoutMs?: number
}

const DEFAULT_UNLOAD_TIMEOUT_MS = 2000

export class EmbeddedPlayer implements PlaybackAdapter {
  private readonly transport: PlayerTransport
  private readonly unloadTimeoutMs: number
  private readonly listeners = new Set<(event: PlaybackEvent) => void>()
  private readonly pendingUnloads = new Map<number, () => void>()
  private stopListening: (() => void) | null = null
  private nextToken = 0
  private nextRequestId = 0
  private disposed = false

  constructor(options: EmbeddedPlayerOptions) {
    this.transport = options.transport
    this.unloadTimeoutMs = options.unloadTimeoutMs ?? DEFAULT_UNLOAD_TIMEOUT_MS
    this.stopListening = this.transport.onMessage((message) => this.handle(message))
  }

  load(path: string): number {
    const token = ++this.nextToken
    if (this.disposed) return token
    // The token has to point at the file before the renderer is told to play it, or the stream
    // request can arrive first and find nothing.
    this.transport.setSource(token, path)
    if (!this.transport.isLive()) {
      // Report it the way every other failure is reported, rather than throwing at the caller.
      queueMicrotask(() => this.emit({ type: 'failed', token, reason: 'The window is not open.' }))
      return token
    }
    this.transport.send({ type: 'load', token })
    return token
  }

  unload(): Promise<void> {
    if (this.disposed || !this.transport.isLive()) return Promise.resolve()
    const requestId = ++this.nextRequestId
    return new Promise<void>((resolve) => {
      const done = (): void => {
        if (!this.pendingUnloads.delete(requestId)) return
        clearTimeout(timer)
        resolve()
      }
      // Resolving on a timeout is the safe direction. The measurement behind this says Chromium
      // does not hold an exclusive lock on a file it is playing, so a trash that goes ahead without
      // the confirmation still succeeds; a promise that never settles would block the undo window
      // instead (PROJECT.md §4).
      const timer = setTimeout(done, this.unloadTimeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      this.pendingUnloads.set(requestId, done)
      this.transport.send({ type: 'unload', requestId })
    })
  }

  onEvent(listener: (event: PlaybackEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    // Let go of the file before dropping the transport, so nothing is left open.
    await this.unload()
    this.disposed = true
    this.stopListening?.()
    this.stopListening = null
    for (const done of [...this.pendingUnloads.values()]) done()
    this.pendingUnloads.clear()
    this.transport.clearSources()
    this.emit({ type: 'exited', reason: 'The built-in player was closed.' })
    this.listeners.clear()
  }

  private handle(message: PlayerEventMessage): void {
    if (this.disposed) return
    switch (message.type) {
      case 'unloaded':
        this.pendingUnloads.get(message.requestId)?.()
        return
      case 'loaded':
      case 'ended':
        this.emit({ type: message.type, token: message.token })
        return
      case 'failed':
        this.emit({ type: 'failed', token: message.token, reason: message.reason })
        return
    }
  }

  private emit(event: PlaybackEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }
}
