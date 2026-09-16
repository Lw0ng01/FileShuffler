import type { IpcMainInvokeEvent } from 'electron'
import { LIBRARY_CHANNELS } from '../shared/library'
import type { IndexerService } from './app/indexerService'
import type { IpcRegistry } from './ipc'

export type LibraryBackend = Pick<
  IndexerService,
  'getView' | 'addRoot' | 'removeRoot' | 'scanAll' | 'cancelScan' | 'largest' | 'recent' | 'search'
>

/** Longest path accepted from the renderer. Real folder paths are far shorter. */
const MAX_PATH_LENGTH = 4096
/** Longest search term accepted. */
const MAX_TERM_LENGTH = 256
/** Most rows one query can ask for, so a renderer bug can't pull the whole index at once. */
const MAX_LIMIT = 500

function asPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH) {
    throw new Error('Expected a folder path')
  }
  return value
}

function asLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    throw new Error('Expected a positive row limit')
  }
  return Math.min(Math.trunc(value), MAX_LIMIT)
}

function asTerm(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_TERM_LENGTH) {
    throw new Error('Expected a search term')
  }
  return value
}

/**
 * Registers the renderer's library commands, with the same rules as the shuffler's (PROJECT.md §5):
 * every call must come from the app's own window, and arguments are checked at runtime because
 * types don't survive IPC. Returns a function that removes the handlers.
 */
export function registerLibraryIpc(
  ipc: IpcRegistry,
  backend: LibraryBackend,
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

  handle(LIBRARY_CHANNELS.getView, () => backend.getView())
  handle(LIBRARY_CHANNELS.addRoot, ([path]) => backend.addRoot(asPath(path)))
  handle(LIBRARY_CHANNELS.removeRoot, ([path]) => backend.removeRoot(asPath(path)))
  handle(LIBRARY_CHANNELS.scan, () => backend.scanAll())
  handle(LIBRARY_CHANNELS.cancelScan, () => backend.cancelScan())
  handle(LIBRARY_CHANNELS.largest, ([limit]) => backend.largest(asLimit(limit)))
  handle(LIBRARY_CHANNELS.recent, ([limit]) => backend.recent(asLimit(limit)))
  handle(LIBRARY_CHANNELS.search, ([term, limit]) => backend.search(asTerm(term), asLimit(limit)))

  return () => {
    for (const channel of channels) ipc.removeHandler(channel)
  }
}
