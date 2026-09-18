/**
 * The contract for the built-in player (PROJECT.md §4). Playback happens in a `<video>` in the
 * renderer, but the application still drives it from main through `PlaybackAdapter`, so this is the
 * wire between the two halves of one adapter rather than an API the UI is free to use.
 *
 * The renderer is never told a path. It is given a token and asks for `fsvideo://file/<token>`,
 * and main decides which file that token refers to - so a compromised page cannot ask for an
 * arbitrary file, and file actions keep resolving against the active session (`CLAUDE.md`).
 */

export const PLAYER_CHANNELS = {
  /** Renderer → main: the video surface exists and can accept commands. */
  ready: 'player:ready',
  /** Renderer → main: something happened to the file being played. */
  event: 'player:event',
  /** Main → renderer: load, unload or shut down. */
  command: 'player:command'
} as const

/** The scheme the video element streams from. Registered in main; never points outside a session. */
export const VIDEO_SCHEME = 'fsvideo'

/** What the video element sets as its `src` for a load. */
export function videoUrl(token: number): string {
  return `${VIDEO_SCHEME}://file/${token}`
}

export type PlayerCommandMessage =
  /** Play this load. The path lives in main; the renderer only ever sees the token. */
  | { type: 'load'; token: number }
  /** Release the current file and confirm with `unloaded`, so a delete can follow safely (§2). */
  | { type: 'unload'; requestId: number }

export type PlayerEventMessage =
  | { type: 'loaded'; token: number }
  | { type: 'ended'; token: number }
  /**
   * `code` is the `MediaError` code, which is what separates "this app cannot play that format"
   * (3 and 4) from "the file would not read" (1 and 2). Only the first kind is worth handing to
   * the system's own player.
   */
  | { type: 'failed'; token: number; reason: string; code: number }
  /** The answer to `unload`, whether or not anything was playing. */
  | { type: 'unloaded'; requestId: number }

/**
 * What the preload bridge exposes as `window.api.player`. It belongs to the video surface, not to
 * the screens: everything here is one-way, because playback is a stream of notifications and
 * nothing waits on a reply.
 */
export interface PlayerApi {
  /** Tells main the video surface exists and can accept commands. */
  ready(): void
  send(event: PlayerEventMessage): void
  onCommand(listener: (command: PlayerCommandMessage) => void): () => void
}
