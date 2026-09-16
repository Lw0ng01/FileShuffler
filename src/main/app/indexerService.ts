import type {
  LibraryDigest,
  LibraryDrive,
  LibraryDuplicateGroup,
  LibraryFile,
  LibraryFilePage,
  LibraryFileQuery,
  LibraryFolder,
  LibraryView,
  ScanProgressView
} from '../../shared/library'
import type { DriveSpace } from '../files/driveSpace'
import type { ScanOptions, ScanSummary } from '../files/scanner'
import { driveOf, scanRoots } from '../files/scanner'
import type { IndexDb } from '../library/indexDb'

export interface IndexerServiceDeps {
  db: IndexDb
  /** Injected so tests can drive scanning without touching a real filesystem. */
  scan?: (options: ScanOptions) => Promise<ScanSummary>
  /** Folders offered the first time, for example the user's Videos and Pictures. */
  defaultRoots?: () => string[]
  /** Shows the folder picker. Resolves null when cancelled. */
  pickFolder?: () => Promise<string | null>
  /** Size and free space of the drive holding a path, or null when it can't be read. */
  driveSpace?: (path: string) => Promise<DriveSpace | null>
  /** Opens a file in the system's default application. Resolves a reason when it fails. */
  openPath?: (path: string) => Promise<string>
  /** Shows a file in the system's file manager. */
  revealPath?: (path: string) => Promise<void>
  /** Fingerprints a file, for confirming duplicates. Null when it can't be read. */
  digest?: (path: string) => Promise<string | null>
  now?: () => number
}

/** Progress updates are throttled to this, so a fast scan can't flood the window with views. */
const PROGRESS_EVERY_MS = 200

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Owns the index: which folders are indexed, running a scan, and the numbers the dashboard reads
 * (PROJECT.md §7 Phase 3). Like `ShufflerService`, it holds no Electron imports, so it can be
 * tested without a window.
 *
 * Scanning never blocks a command: one scan runs at a time, it can be cancelled, and a cancelled
 * pass deliberately skips the sweep, because "not seen yet" must never be mistaken for "deleted".
 */
export class IndexerService {
  private readonly deps: IndexerServiceDeps
  private readonly listeners = new Set<(view: LibraryView) => void>()
  private readonly scan: (options: ScanOptions) => Promise<ScanSummary>
  private scanning: Promise<void> | null = null
  private controller: AbortController | null = null
  private progress: ScanProgressView | null = null
  private lastScan: LibraryView['lastScan'] = null
  private error: string | null = null
  private lastProgressAt = 0
  private disposed = false
  /** Capacity per drive, refreshed after scans rather than read on every view. */
  private readonly space = new Map<string, DriveSpace>()

  constructor(deps: IndexerServiceDeps) {
    this.deps = deps
    this.scan = deps.scan ?? scanRoots
  }

  /** Adds the default folders, for a first run with nothing indexed yet. */
  addDefaultRoots(): void {
    if (this.deps.db.roots().length > 0) return
    for (const root of this.deps.defaultRoots?.() ?? []) this.deps.db.addRoot(root)
    this.emit()
  }

  getView(): LibraryView {
    const roots = this.deps.db.roots()
    const totals = this.deps.db.totalsByCategory()
    return {
      status: this.scanning === null ? 'idle' : 'scanning',
      roots: roots.map((root) => ({
        path: root.path,
        lastScanAt: root.lastScanAt,
        files: root.files,
        bytes: root.bytes
      })),
      totals,
      drives: this.drives(),
      files: totals.reduce((sum, total) => sum + total.files, 0),
      bytes: totals.reduce((sum, total) => sum + total.bytes, 0),
      progress: this.progress,
      lastScan: this.lastScan,
      lastError: this.error
    }
  }

  onView(listener: (view: LibraryView) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  addRoot(path: string): LibraryView {
    this.deps.db.addRoot(path)
    this.error = null
    this.emit()
    return this.getView()
  }

  /** Opens the folder picker and indexes the chosen folder. Unchanged if cancelled. */
  async chooseRoot(): Promise<LibraryView> {
    const folder = await this.deps.pickFolder?.()
    if (folder === null || folder === undefined || this.disposed) return this.getView()
    this.deps.db.addRoot(folder)
    this.error = null
    await this.refreshDriveSpace()
    this.emit()
    return this.getView()
  }

  removeRoot(path: string): LibraryView {
    this.deps.db.removeRoot(path)
    this.emit()
    return this.getView()
  }

  /**
   * Re-reads each indexed drive's size and free space. Every indexed file sits under a root, so
   * the roots cover every drive the dashboard shows.
   */
  async refreshDriveSpace(): Promise<void> {
    const read = this.deps.driveSpace
    if (read === undefined) return
    for (const root of this.deps.db.roots()) {
      const space = await read(root.path)
      const drive = driveOf(root.path)
      if (space === null) this.space.delete(drive)
      else this.space.set(drive, space)
    }
  }

  largest(limit?: number): LibraryFile[] {
    return this.deps.db.largest(limit)
  }

  recent(limit?: number): LibraryFile[] {
    return this.deps.db.recent(limit)
  }

  search(term: string, limit?: number): LibraryFile[] {
    return this.deps.db.search(term, limit)
  }

  query(query: LibraryFileQuery): LibraryFilePage {
    return this.deps.db.queryFiles(query)
  }

  biggestFolders(limit?: number): LibraryFolder[] {
    return this.deps.db.biggestFolders(limit)
  }

  /** Files that share a name and size. Possible copies: only `checkDuplicate` confirms them. */
  duplicates(limit?: number): LibraryDuplicateGroup[] {
    return this.deps.db.duplicateCandidates(limit)
  }

  /** Files nothing has changed in at least this many days, biggest first. */
  notTouched(days = 180, limit?: number): LibraryFile[] {
    const now = (this.deps.now ?? Date.now)()
    const safeDays = Number.isFinite(days) ? Math.max(1, days) : 180
    return this.deps.db.notTouchedSince(now - safeDays * 24 * 60 * 60 * 1000, limit)
  }

  /**
   * Reads each file in a group and fingerprints it, so "same name and size" can become "these
   * really are copies" (`fileDigest`). Files are read one at a time to keep the disk free for
   * whatever else is happening, and an unreadable file comes back with a null fingerprint rather
   * than failing the whole check.
   */
  async checkDuplicate(name: string, size: number): Promise<LibraryDigest[]> {
    const files = this.deps.db.filesNamed(name, size)
    const digest = this.deps.digest
    const checked: LibraryDigest[] = []
    for (const file of files) {
      checked.push({
        path: file.path,
        digest: digest === undefined ? null : await digest(file.path)
      })
    }
    return checked
  }

  /**
   * Opens a file in the system's default application. Only paths the indexer catalogued can be
   * opened: the renderer names a file, and this checks that name against the index first, so a
   * bug or injected script can never make the app launch something arbitrary (PROJECT.md §5).
   */
  async openFile(path: string): Promise<void> {
    if (!this.known(path)) return
    const failure = await this.deps.openPath?.(path)
    if (failure !== undefined && failure.length > 0) {
      this.error = `Could not open ${path}: ${failure}`
      this.emit()
    }
  }

  /** Shows an indexed file in the system's file manager, with the same check as opening. */
  async showInFolder(path: string): Promise<void> {
    if (!this.known(path)) return
    try {
      await this.deps.revealPath?.(path)
    } catch (error) {
      this.error = `Could not show ${path}: ${message(error)}`
      this.emit()
    }
  }

  private known(path: string): boolean {
    // Play history counts too: a shuffle folder isn't necessarily indexed, and the Stats tab lists
    // what played. Either way it is a path the app itself recorded, never one the renderer made up.
    if (this.deps.db.hasFile(path) || this.deps.db.hasPlayed(path)) return true
    // Usually the file was deleted or moved since the last scan, rather than anything sinister.
    this.error = `${path} is not in the index. Scan again if it has moved or changed.`
    this.emit()
    return false
  }

  /** Indexes every root, one at a time. A second call while scanning joins the running scan. */
  async scanAll(): Promise<void> {
    if (this.scanning !== null) return this.scanning
    if (this.disposed) return
    this.scanning = this.runScan().finally(() => {
      this.scanning = null
      this.controller = null
      this.progress = null
      this.emit()
    })
    return this.scanning
  }

  cancelScan(): void {
    this.controller?.abort()
  }

  dispose(): void {
    this.disposed = true
    this.cancelScan()
    this.listeners.clear()
  }

  private async runScan(): Promise<void> {
    const now = this.deps.now ?? Date.now
    const controller = new AbortController()
    this.controller = controller
    this.error = null
    this.progress = { folders: 0, files: 0, bytes: 0, current: '' }
    this.emit()

    let files = 0
    let removed = 0
    let errors = 0
    let cancelled = false

    for (const root of this.deps.db.roots()) {
      if (controller.signal.aborted) {
        cancelled = true
        break
      }
      const scanId = this.deps.db.startScan()
      let summary: ScanSummary
      try {
        summary = await this.scan({
          roots: [root.path],
          signal: controller.signal,
          onBatch: (batch) => {
            this.deps.db.putFiles(scanId, batch)
          },
          onProgress: (progress) => this.reportProgress(progress)
        })
      } catch (error) {
        this.error = `Could not index ${root.path}: ${message(error)}`
        errors += 1
        continue
      }

      files += summary.files
      errors += summary.errors.length
      if (summary.cancelled) {
        // A cancelled pass saw only part of the folder, so sweeping would delete files that are
        // still there. Keep what was written and leave the rest of the index alone.
        cancelled = true
        break
      }
      removed += this.deps.db.finishRoot(root.path, scanId).removed
    }

    await this.refreshDriveSpace()
    this.lastScan = { finishedAt: now(), files, removed, errors, cancelled }
    if (errors > 0 && this.error === null) {
      this.error = `${errors} ${errors === 1 ? 'folder' : 'folders'} could not be read and were skipped.`
    }
  }

  /** Indexed drives, plus any drive holding a root that has nothing indexed yet. */
  private drives(): LibraryDrive[] {
    const totals = this.deps.db.totalsByDrive()
    const known = new Map<string, LibraryDrive>()
    for (const total of totals) {
      const space = this.space.get(total.drive)
      known.set(total.drive, {
        ...total,
        total: space?.total ?? null,
        free: space?.free ?? null
      })
    }
    for (const root of this.deps.db.roots()) {
      const drive = driveOf(root.path)
      if (known.has(drive)) continue
      const space = this.space.get(drive)
      known.set(drive, {
        drive,
        files: 0,
        bytes: 0,
        total: space?.total ?? null,
        free: space?.free ?? null
      })
    }
    return [...known.values()].sort((a, b) => b.bytes - a.bytes || a.drive.localeCompare(b.drive))
  }

  private reportProgress(progress: ScanProgressView): void {
    this.progress = progress
    const now = (this.deps.now ?? Date.now)()
    if (now - this.lastProgressAt < PROGRESS_EVERY_MS) return
    this.lastProgressAt = now
    this.emit()
  }

  private emit(): void {
    if (this.disposed) return
    const view = this.getView()
    for (const listener of [...this.listeners]) listener(view)
  }
}
