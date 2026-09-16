import type { IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '../shared/shuffler'
import type { ShufflerService } from './app/shufflerService'

/** The part of Electron's `ipcMain` used here, so tests can pass a fake. */
export interface IpcRegistry {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void
  removeHandler(channel: string): void
}

export type ShufflerBackend = Pick<
  ShufflerService,
  | 'getView'
  | 'chooseFolder'
  | 'play'
  | 'next'
  | 'back'
  | 'deleteCurrent'
  | 'undoDelete'
  | 'restartCycle'
>

/** Longest file name accepted from the renderer; real names are far shorter. */
const MAX_ID_LENGTH = 1024

/**
 * Registers the renderer's commands (PROJECT.md §5). Every call must come from the app's own
 * window, and arguments are checked at runtime because TypeScript types don't exist over IPC.
 * The renderer can only name a file to undo; it never supplies paths.
 * Returns a function that removes the handlers.
 */
export function registerShufflerIpc(
  ipc: IpcRegistry,
  backend: ShufflerBackend,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
): () => void {
  const channels: string[] = []
  const handle = (channel: string, run: (args: unknown[]) => unknown): void => {
    channels.push(channel)
    ipc.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) throw new Error('Rejected a request from an untrusted sender')
      return run(args)
    })
  }

  handle(CHANNELS.getView, () => backend.getView())
  handle(CHANNELS.chooseFolder, () => backend.chooseFolder())
  handle(CHANNELS.play, () => backend.play())
  handle(CHANNELS.next, () => backend.next())
  handle(CHANNELS.back, () => backend.back())
  handle(CHANNELS.deleteCurrent, () => backend.deleteCurrent())
  handle(CHANNELS.undoDelete, ([id]) => {
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) {
      throw new Error('undoDelete expects the name of a pending delete')
    }
    return backend.undoDelete(id)
  })
  handle(CHANNELS.restartCycle, () => backend.restartCycle())

  return () => {
    for (const channel of channels) ipc.removeHandler(channel)
  }
}
