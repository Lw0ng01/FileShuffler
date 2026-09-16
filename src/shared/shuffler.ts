/**
 * Shared by the main process, the preload bridge and the renderer. The renderer only imports
 * types from here; the channel names are used by main and preload.
 */

/** IPC channel names. The renderer never sees these; it uses `window.api.shuffler`. */
export const CHANNELS = {
  getView: 'shuffler:get-view',
  chooseFolder: 'shuffler:choose-folder',
  play: 'shuffler:play',
  next: 'shuffler:next',
  back: 'shuffler:back',
  deleteCurrent: 'shuffler:delete-current',
  undoDelete: 'shuffler:undo-delete',
  /** Main → renderer: a new `ShufflerView`. */
  view: 'shuffler:view'
} as const

/**
 * - `no-folder`: nothing chosen yet
 * - `ready`: a folder is loaded and nothing is playing yet
 * - `starting-player`: mpv is launching
 * - `loading` / `playing`: a file was sent to the player / the player confirmed it opened
 * - `finished`: nothing left that can play
 * - `player-exited`: the player window was closed; Play reopens it
 */
export type ShufflerStatus =
  'no-folder' | 'ready' | 'starting-player' | 'loading' | 'playing' | 'finished' | 'player-exited'

export interface ShufflerView {
  folder: string | null
  status: ShufflerStatus
  current: string | null
  cycle: number
  total: number
  opened: number
  failed: number
  /** Recently opened files, newest first. */
  recent: string[]
  /** Deletes that can still be undone, with when each one's window ends (ms since epoch). */
  pendingDeletes: { id: string; deadline: number }[]
  lastError: string | null
  /** Keys bound inside the player window. */
  playerKeys: { next: string; back: string; delete: string }
}

/**
 * What an Undo did:
 * - `restored`: the file is back in the shuffle and will not be trashed
 * - `trashing`: the undo window had ended and the trash step had begun, which can't be stopped
 * - `unknown`: that name was no longer waiting to be deleted (already trashed, or kept because
 *   something went wrong, in which case `lastError` explains it)
 */
export type UndoResult = 'restored' | 'trashing' | 'unknown'

/** What the preload bridge exposes to the renderer as `window.api.shuffler`. */
export interface ShufflerApi {
  getView(): Promise<ShufflerView>
  /** Opens the folder picker and resolves with the resulting view (unchanged if cancelled). */
  chooseFolder(): Promise<ShufflerView>
  /** Starts the shuffle, or reopens the player where it left off. */
  play(): Promise<void>
  next(): Promise<void>
  back(): Promise<void>
  deleteCurrent(): Promise<void>
  /** Cancels a pending delete and reports what happened. */
  undoDelete(id: string): Promise<UndoResult>
  /** Subscribes to view updates and returns an unsubscribe function. */
  onView(listener: (view: ShufflerView) => void): () => void
}
