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
  /** What a token points at, for the handful of files that have to go elsewhere. */
  pathFor(token: number): string | null
}

export interface EmbeddedPlayerOptions {
  transport: PlayerTransport
  /**
   * Opens a file in whatever the system is set to use, for the formats Chromium cannot decode -
   * Matroska, AVI, WMV and the odd AC-3 soundtrack, about 1% of a real library (PROJECT.md §4).
   * Resolves with an empty string on success, or the reason it could not, like `shell.openPath`.
   *
   * Without it those files are simply skipped, which is the behaviour when it is not supplied.
   */
  openExternally?: (path: string) => Promise<string>
  /**
   * How long to wait for the renderer to confirm it has let go of the file. The delete flow waits
   * on this, so it must fail open rather than hang: a page that never answers must not be able to
   * stall a trash operation forever (PROJECT.md §2).
   */
  unloadTimeoutMs?: number
}

const DEFAULT_UNLOAD_TIMEOUT_MS = 2000

/** `MediaError` codes that mean "this app cannot play that", rather than "that file is no good". */
const MEDIA_ERR_DECODE = 3
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4

export class EmbeddedPlayer implements PlaybackAdapter {
  private readonly transport: PlayerTransport
  private readonly openExternally: ((path: string) => Promise<string>) | undefined
  private readonly unloadTimeoutMs: number
  private readonly listeners = new Set<(event: PlaybackEvent) => void>()
  private readonly pendingUnloads = new Map<number, () => void>()
  private stopListening: (() => void) | null = null
  private nextToken = 0
  private nextRequestId = 0
  private disposed = false

  constructor(options: EmbeddedPlayerOptions) {
    this.transport = options.transport
    this.openExternally = options.openExternally
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
        this.handleFailure(message.token, message.reason, message.code)
        return
    }
  }

  /**
   * A file the built-in player cannot decode is not a broken file, so it goes to the system's own
   * player rather than being skipped. Anything else - unreadable, gone, aborted - is a real
   * failure and is reported as one.
   *
   * The shuffle deliberately stays on it afterwards (`external` counts as opened). Advancing would
   * start the next file in here while that one is still playing over there, and two videos at once
   * is worse than either.
   */
  private handleFailure(token: number, reason: string, code: number): void {
    const fallback = this.openExternally
    const path = this.transport.pathFor(token)
    const unsupported = code === MEDIA_ERR_DECODE || code === MEDIA_ERR_SRC_NOT_SUPPORTED
    if (fallback === undefined || path === null || !unsupported) {
      this.emit({ type: 'failed', token, reason })
      return
    }

    void fallback(path).then(
      (problem) => {
        if (this.disposed) return
        // `shell.openPath` answers with the reason rather than throwing, and an empty string means
        // it worked.
        if (problem === '') this.emit({ type: 'external', token })
        else this.emit({ type: 'failed', token, reason: problem })
      },
      (error: unknown) => {
        if (this.disposed) return
        this.emit({
          type: 'failed',
          token,
          reason: error instanceof Error ? error.message : String(error)
        })
      }
    )
  }

  private emit(event: PlaybackEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }
}
