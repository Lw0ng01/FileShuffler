/**
 * The boundary between the application and a media player (PROJECT.md §4).
 *
 * mpv implements it first. VLC (Phase 2) reports state by polling and an embedded player may come
 * later, so nothing here assumes pushed events or a particular process model.
 */

/** Commands a player sends back, for example from key bindings inside its window. */
export type PlayerCommand = 'next' | 'back' | 'delete'

export type PlaybackEvent =
  /** The player opened the file for this load. */
  | { type: 'loaded'; token: number }
  /** The file for this load played to its natural end. */
  | { type: 'ended'; token: number }
  /** The player could not open or play the file for this load. */
  | { type: 'failed'; token: number; reason: string }
  /**
   * The file opened, but in the system's own player rather than in this one - the fallback for
   * formats the built-in player cannot decode (PROJECT.md §4). It counts as opened, so the shuffle
   * stays on it: advancing would start the next file here while that one is still playing there.
   */
  | { type: 'external'; token: number }
  | { type: 'command'; command: PlayerCommand }
  /** The player is gone (closed by the user, crashed, or disposed). */
  | { type: 'exited'; reason: string }

export interface PlaybackAdapter {
  /**
   * Starts loading a file, replacing whatever is playing, and returns a token for this load.
   * Tokens increase with every call. Events for older tokens may still arrive late; callers must
   * ignore them. Failures are reported as a `failed` event, never thrown.
   */
  load(path: string): number
  /** Stops playback and resolves once the player reports the current file is released. */
  unload(): Promise<void>
  /** Subscribes to player events and returns an unsubscribe function. */
  onEvent(listener: (event: PlaybackEvent) => void): () => void
  /** Shuts the player down and releases its resources. Safe to call more than once. */
  dispose(): Promise<void>
}
