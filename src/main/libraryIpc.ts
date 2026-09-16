import type { IpcMainInvokeEvent } from 'electron'
import { LIBRARY_CHANNELS, type LibraryCategory, type LibraryFileQuery } from '../shared/library'
import type { IndexerService } from './app/indexerService'
import type { IpcRegistry } from './ipc'

export type LibraryBackend = Pick<
  IndexerService,
  | 'getView'
  | 'addRoot'
  | 'chooseRoot'
  | 'removeRoot'
  | 'scanAll'
  | 'scanRoot'
  | 'cancelScan'
  | 'largest'
  | 'recent'
  | 'search'
  | 'openFile'
  | 'showInFolder'
  | 'biggestFolders'
  | 'duplicates'
  | 'notTouched'
  | 'checkDuplicate'
  | 'query'
  | 'refreshDriveSpace'
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

function asDays(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    throw new Error('Expected a number of days')
  }
  return Math.min(Math.trunc(value), 36_500)
}

function asSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Expected a file size')
  }
  return Math.trunc(value)
}

function asTerm(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_TERM_LENGTH) {
    throw new Error('Expected a search term')
  }
  return value
}

const CATEGORIES: ReadonlySet<string> = new Set(['video', 'photo', 'audio', 'document'])
const SORTS: ReadonlySet<string> = new Set(['size', 'modified', 'name'])
/** A drive is `C:` or `/`; nothing longer is a real one. */
const MAX_DRIVE_LENGTH = 16
const MAX_DRIVES = 64
const MAX_OFFSET = 10_000_000

function asQueryNumber(value: unknown, field: string, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`Expected a sensible ${field}`)
  }
  return Math.trunc(value)
}

/**
 * Checks a browsing query field by field. Unknown fields are dropped, categories and sorts must
 * come from fixed lists, and numbers must be finite and in range, so what reaches the store is
 * exactly a `LibraryFileQuery` and nothing else.
 */
function asFileQuery(value: unknown): LibraryFileQuery {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a file query')
  }
  const input = value as Record<string, unknown>
  const query: LibraryFileQuery = {}

  if (input['term'] !== undefined) query.term = asTerm(input['term'])
  if (input['categories'] !== undefined) {
    const categories = input['categories']
    if (
      !Array.isArray(categories) ||
      !categories.every((entry) => typeof entry === 'string' && CATEGORIES.has(entry))
    ) {
      throw new Error('Expected categories from the known list')
    }
    query.categories = categories as LibraryCategory[]
  }
  if (input['drives'] !== undefined) {
    const drives = input['drives']
    if (
      !Array.isArray(drives) ||
      drives.length > MAX_DRIVES ||
      !drives.every(
        (entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= MAX_DRIVE_LENGTH
      )
    ) {
      throw new Error('Expected a list of drives')
    }
    query.drives = drives as string[]
  }
  if (input['minSize'] !== undefined) {
    query.minSize = asQueryNumber(input['minSize'], 'minimum size', Number.MAX_SAFE_INTEGER)
  }
  if (input['maxSize'] !== undefined) {
    query.maxSize = asQueryNumber(input['maxSize'], 'maximum size', Number.MAX_SAFE_INTEGER)
  }
  if (input['sort'] !== undefined) {
    if (typeof input['sort'] !== 'string' || !SORTS.has(input['sort'])) {
      throw new Error('Expected a sort from the known list')
    }
    query.sort = input['sort'] as LibraryFileQuery['sort']
  }
  if (input['direction'] !== undefined) {
    if (input['direction'] !== 'asc' && input['direction'] !== 'desc') {
      throw new Error('Expected asc or desc')
    }
    query.direction = input['direction']
  }
  if (input['offset'] !== undefined) {
    query.offset = asQueryNumber(input['offset'], 'offset', MAX_OFFSET)
  }
  if (input['limit'] !== undefined) query.limit = asLimit(input['limit'])
  return query
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

  // Drive capacity comes from the filesystem, so it is refreshed when the window asks for a view
  // rather than on every internal update.
  handle(LIBRARY_CHANNELS.getView, async () => {
    await backend.refreshDriveSpace()
    return backend.getView()
  })
  handle(LIBRARY_CHANNELS.addRoot, ([path]) => backend.addRoot(asPath(path)))
  handle(LIBRARY_CHANNELS.chooseRoot, () => backend.chooseRoot())
  handle(LIBRARY_CHANNELS.removeRoot, ([path]) => backend.removeRoot(asPath(path)))
  handle(LIBRARY_CHANNELS.scan, () => backend.scanAll())
  handle(LIBRARY_CHANNELS.scanRoot, ([path]) => backend.scanRoot(asPath(path)))
  handle(LIBRARY_CHANNELS.cancelScan, () => backend.cancelScan())
  handle(LIBRARY_CHANNELS.largest, ([limit]) => backend.largest(asLimit(limit)))
  handle(LIBRARY_CHANNELS.recent, ([limit]) => backend.recent(asLimit(limit)))
  handle(LIBRARY_CHANNELS.search, ([term, limit]) => backend.search(asTerm(term), asLimit(limit)))
  handle(LIBRARY_CHANNELS.query, ([query]) => backend.query(asFileQuery(query)))
  // The path is checked against the index in the service before anything is opened.
  handle(LIBRARY_CHANNELS.openFile, ([path]) => backend.openFile(asPath(path)))
  handle(LIBRARY_CHANNELS.showInFolder, ([path]) => backend.showInFolder(asPath(path)))
  handle(LIBRARY_CHANNELS.biggestFolders, ([limit]) => backend.biggestFolders(asLimit(limit)))
  handle(LIBRARY_CHANNELS.duplicates, ([limit]) => backend.duplicates(asLimit(limit)))
  handle(LIBRARY_CHANNELS.notTouched, ([days, limit]) =>
    backend.notTouched(asDays(days), asLimit(limit))
  )
  handle(LIBRARY_CHANNELS.checkDuplicate, ([name, size]) =>
    backend.checkDuplicate(asPath(name), asSize(size))
  )

  return () => {
    for (const channel of channels) ipc.removeHandler(channel)
  }
}
