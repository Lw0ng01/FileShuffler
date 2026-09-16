import type { IpcMainInvokeEvent } from 'electron'
import type { LibrarySort } from '../shared/library'
import { STATS_CHANNELS } from '../shared/stats'
import type { StatsService } from './app/statsService'
import type { IpcRegistry } from './ipc'

export type StatsBackend = Pick<
  StatsService,
  'getView' | 'addFavorite' | 'removeFavorite' | 'neverPlayed'
>

/** Longest path accepted from the renderer. */
const MAX_PATH_LENGTH = 4096
/** Most rows one list request may ask for. */
const MAX_LIMIT = 500
const SORTS: ReadonlySet<string> = new Set(['size', 'modified', 'name'])

function asLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    throw new Error('Expected a positive row limit')
  }
  return Math.min(Math.trunc(value), MAX_LIMIT)
}

function asSort(value: unknown): LibrarySort {
  if (typeof value !== 'string' || !SORTS.has(value)) {
    throw new Error('Expected a sort from the known list')
  }
  return value as LibrarySort
}

function asPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH) {
    throw new Error('Expected a file path')
  }
  return value
}

/**
 * Registers the stats commands, with the same rules as the shuffler's and the library's IPC
 * (PROJECT.md §5): the app's own window only, arguments checked at runtime. The service then
 * checks that a path is known before starring it. Returns a function that removes the handlers.
 */
export function registerStatsIpc(
  ipc: IpcRegistry,
  backend: StatsBackend,
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

  handle(STATS_CHANNELS.getView, () => backend.getView())
  handle(STATS_CHANNELS.addFavorite, ([path]) => backend.addFavorite(asPath(path)))
  handle(STATS_CHANNELS.removeFavorite, ([path]) => backend.removeFavorite(asPath(path)))
  handle(STATS_CHANNELS.neverPlayed, ([limit, sort]) =>
    backend.neverPlayed(asLimit(limit), asSort(sort))
  )

  return () => {
    for (const channel of channels) ipc.removeHandler(channel)
  }
}
