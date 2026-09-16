/**
 * The library (indexer and dashboard) contract, shared by the main process, the preload bridge and
 * the renderer, like `shuffler.ts`. The renderer imports only types; main and preload use the
 * channel names.
 */

export const LIBRARY_CHANNELS = {
  getView: 'library:get-view',
  addRoot: 'library:add-root',
  chooseRoot: 'library:choose-root',
  removeRoot: 'library:remove-root',
  scan: 'library:scan',
  cancelScan: 'library:cancel-scan',
  largest: 'library:largest',
  recent: 'library:recent',
  search: 'library:search',
  openFile: 'library:open-file',
  showInFolder: 'library:show-in-folder',
  biggestFolders: 'library:biggest-folders',
  duplicates: 'library:duplicates',
  notTouched: 'library:not-touched',
  checkDuplicate: 'library:check-duplicate',
  query: 'library:query',
  /** Main → renderer: a new `LibraryView`. */
  view: 'library:view'
} as const

/** Categories the indexer collects (PROJECT.md §2.4: an allowlist of personal files). */
export type LibraryCategory = 'video' | 'photo' | 'audio' | 'document'

export interface LibraryRoot {
  path: string
  /** When this folder was last indexed, or null if it never has been. */
  lastScanAt: number | null
  files: number
  bytes: number
}

export interface LibraryTotal {
  category: LibraryCategory
  files: number
  bytes: number
}

export interface LibraryDrive {
  drive: string
  /** Files indexed on this drive, and their total size. */
  files: number
  bytes: number
  /** Capacity from the filesystem, or null when it couldn't be read (an unplugged drive). */
  total: number | null
  free: number | null
}

export interface LibraryFile {
  path: string
  name: string
  folder: string
  drive: string
  category: LibraryCategory
  size: number
  modifiedMs: number
}

export interface LibraryFolder {
  folder: string
  drive: string
  files: number
  bytes: number
}

export interface LibraryDuplicateGroup {
  name: string
  size: number
  /** What deleting all but one copy would free. */
  wastedBytes: number
  files: LibraryFile[]
}

/**
 * One file's fingerprint from a duplicate check. Files sharing a fingerprint are the same size and
 * identical at both ends; null means the file couldn't be read.
 */
export interface LibraryDigest {
  path: string
  digest: string | null
}

export type LibrarySort = 'size' | 'modified' | 'name'

/** Filters, sort and page for browsing the index. Every field is optional. */
export interface LibraryFileQuery {
  term?: string
  categories?: LibraryCategory[]
  drives?: string[]
  minSize?: number
  maxSize?: number
  sort?: LibrarySort
  direction?: 'asc' | 'desc'
  offset?: number
  limit?: number
}

export interface LibraryFilePage {
  rows: LibraryFile[]
  /** Every file matching the filters, so the UI can say "showing 50 of 1,284". */
  total: number
}

export interface ScanProgressView {
  folders: number
  files: number
  bytes: number
  /** The folder being read right now, so the UI can show movement. */
  current: string
}

export interface ScanSummaryView {
  finishedAt: number
  files: number
  /** Rows dropped because the files are no longer on disk. */
  removed: number
  /** Folders that could not be read, for example permission denied. */
  errors: number
  cancelled: boolean
}

export interface LibraryView {
  status: 'idle' | 'scanning'
  roots: LibraryRoot[]
  totals: LibraryTotal[]
  drives: LibraryDrive[]
  files: number
  bytes: number
  progress: ScanProgressView | null
  lastScan: ScanSummaryView | null
  lastError: string | null
}

/** What the preload bridge exposes to the renderer as `window.api.library`. */
export interface LibraryApi {
  getView(): Promise<LibraryView>
  /** Adds a folder to index. Ignored if it is already there. */
  addRoot(path: string): Promise<LibraryView>
  /** Opens the folder picker and indexes what was chosen. Unchanged if cancelled. */
  chooseRoot(): Promise<LibraryView>
  /** Forgets a folder and everything indexed under it. */
  removeRoot(path: string): Promise<LibraryView>
  /** Indexes every root. Resolves when the scan finishes or is cancelled. */
  scan(): Promise<void>
  cancelScan(): Promise<void>
  largest(limit?: number): Promise<LibraryFile[]>
  recent(limit?: number): Promise<LibraryFile[]>
  search(term: string, limit?: number): Promise<LibraryFile[]>
  /** Opens an indexed file in whatever application the system uses for it. */
  openFile(path: string): Promise<void>
  /** Shows an indexed file in the system's file manager. */
  showInFolder(path: string): Promise<void>
  /** Folders holding the most indexed data. */
  biggestFolders(limit?: number): Promise<LibraryFolder[]>
  /** Files that share a name and size: possible copies, not confirmed ones. */
  duplicates(limit?: number): Promise<LibraryDuplicateGroup[]>
  /** Big files nothing has changed in at least `days`. */
  notTouched(days?: number, limit?: number): Promise<LibraryFile[]>
  /** Reads a group's files and fingerprints each, to confirm they really are copies. */
  checkDuplicate(name: string, size: number): Promise<LibraryDigest[]>
  /** Filtered, sorted, paged browsing of the whole index. */
  query(query: LibraryFileQuery): Promise<LibraryFilePage>
  onView(listener: (view: LibraryView) => void): () => void
}
