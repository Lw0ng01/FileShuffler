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
import { isInsideFolder, systemSkipRules, type SkipRules } from '../files/scanRules'
import type { CategoryTotal, DriveTotal } from '../library/indexDb'
import type { IndexStore } from '../library/indexStore'

export interface IndexerServiceDeps {
  /** The index, answered by a worker thread in the app (`workerIndexStore.ts`). */
  db: IndexStore
  /** Injected so tests can drive scanning without touching a real filesystem. */
  scan?: (options: ScanOptions) => Promise<ScanSummary>
  /** Folders offered the first time, for example the user's Videos and Pictures. */
  defaultRoots?: () => string[]
  /** Shows the folder picker, worded for what the folder is for. Resolves null when cancelled. */
  pickFolder?: (purpose: 'index' | 'exclude') => Promise<string | null>
  /** The platform's built-in skip rules. Folders excluded in Settings are added at each scan. */
  rules?: SkipRules
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

interface Totals {
  categories: CategoryTotal[]
  drives: DriveTotal[]
}

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
  private readonly rules: SkipRules
  private scanning: Promise<void> | null = null
  private controller: AbortController | null = null
  private progress: ScanProgressView | null = null
  private lastScan: LibraryView['lastScan'] = null
  private error: string | null = null
  private lastProgressAt = 0
  private disposed = false
  /** Capacity per drive, refreshed after scans rather than read on every view. */
  private readonly space = new Map<string, DriveSpace>()
  /**
   * Category and drive totals, kept until the index changes. They are summed across every indexed
   * file, and views are built every 200 ms during a scan: recomputing them each time took about
   * 120 ms of every 200 on a 250,000-file library (PROJECT.md §7 measure and harden). Null means
   * "recompute on next use".
   */
  private cachedTotals: Promise<Totals> | null = null
  /**
   * Views are built from answers that arrive later, so two built close together could finish out
   * of order. Each gets a number, and one older than a view already sent is dropped.
   */
  private viewsStarted = 0
  private viewsSent = 0

  constructor(deps: IndexerServiceDeps) {
    this.deps = deps
    this.scan = deps.scan ?? scanRoots
    this.rules = deps.rules ?? systemSkipRules()
  }

  /** Adds the default folders, for a first run with nothing indexed yet. */
  async addDefaultRoots(): Promise<void> {
    if ((await this.deps.db.roots()).length > 0) return
    for (const root of this.deps.defaultRoots?.() ?? []) await this.deps.db.addRoot(root)
    await this.publish()
  }

  async getView(): Promise<LibraryView> {
    const [roots, excluded, totals, drives] = await Promise.all([
      this.deps.db.roots(),
      this.deps.db.excludedFolders(),
      this.totals(),
      this.drives()
    ])
    return {
      status: this.scanning === null ? 'idle' : 'scanning',
      roots: roots.map((root) => ({
        path: root.path,
        lastScanAt: root.lastScanAt,
        files: root.files,
        bytes: root.bytes
      })),
      excluded,
      totals: totals.categories,
      drives,
      files: totals.categories.reduce((sum, total) => sum + total.files, 0),
      bytes: totals.categories.reduce((sum, total) => sum + total.bytes, 0),
      progress: this.progress,
      lastScan: this.lastScan,
      lastError: this.error
    }
  }

  onView(listener: (view: LibraryView) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async addRoot(path: string): Promise<LibraryView> {
    if (!(await this.canIndex(path))) return this.publish()
    await this.deps.db.addRoot(path)
    this.error = null
    return this.publish()
  }

  /** Opens the folder picker and indexes the chosen folder. Unchanged if cancelled. */
  async chooseRoot(): Promise<LibraryView> {
    const folder = await this.deps.pickFolder?.('index')
    if (folder === null || folder === undefined || this.disposed) return this.getView()
    if (!(await this.canIndex(folder))) return this.publish()
    await this.deps.db.addRoot(folder)
    this.error = null
    await this.refreshDriveSpace()
    return this.publish()
  }

  /**
   * Opens the folder picker and leaves the chosen folder out of the index: what's already indexed
   * inside it disappears now, and scans skip it from then on. The folder comes from the system's
   * picker, never from the page. Only index entries are removed; no file is touched.
   */
  async chooseExcluded(): Promise<LibraryView> {
    if (this.refuseWhileScanning()) return this.publish()
    const folder = await this.deps.pickFolder?.('exclude')
    if (folder === null || folder === undefined || this.disposed) return this.getView()
    if (this.refuseWhileScanning()) return this.publish()

    // Excluding an indexed folder, or a folder holding one, would make every scan report it as
    // skipped. Removing the indexed folder is the clear way to do that.
    const root = (await this.deps.db.roots()).find((entry) =>
      isInsideFolder(entry.path, folder, this.rules.caseInsensitive)
    )
    if (root !== undefined) {
      this.error =
        root.path === folder
          ? `${folder} is an indexed folder. Remove it from Indexed folders instead.`
          : `${folder} holds the indexed folder ${root.path}. Remove that from Indexed folders first.`
      return this.publish()
    }

    await this.deps.db.excludeFolder(folder, this.rules.caseInsensitive)
    this.error = null
    this.invalidateTotals()
    return this.publish()
  }

  /** Stops excluding a folder. Its files return with the next scan. */
  async removeExcluded(path: string): Promise<LibraryView> {
    if (this.refuseWhileScanning()) return this.publish()
    await this.deps.db.includeFolder(path)
    this.error = null
    return this.publish()
  }

  async removeRoot(path: string): Promise<LibraryView> {
    await this.deps.db.removeRoot(path)
    this.invalidateTotals()
    return this.publish()
  }

  /**
   * Re-reads each indexed drive's size and free space. Every indexed file sits under a root, so
   * the roots cover every drive the dashboard shows.
   */
  async refreshDriveSpace(): Promise<void> {
    const read = this.deps.driveSpace
    if (read === undefined) return
    for (const root of await this.deps.db.roots()) {
      const space = await read(root.path)
      const drive = driveOf(root.path)
      if (space === null) this.space.delete(drive)
      else this.space.set(drive, space)
    }
  }

  largest(limit?: number): Promise<LibraryFile[]> {
    return this.deps.db.largest(limit)
  }

  recent(limit?: number): Promise<LibraryFile[]> {
    return this.deps.db.recent(limit)
  }

  search(term: string, limit?: number): Promise<LibraryFile[]> {
    return this.deps.db.search(term, limit)
  }

  query(query: LibraryFileQuery): Promise<LibraryFilePage> {
    return this.deps.db.queryFiles(query)
  }

  biggestFolders(limit?: number): Promise<LibraryFolder[]> {
    return this.deps.db.biggestFolders(limit)
  }

  /** Files that share a name and size. Possible copies: only `checkDuplicate` confirms them. */
  duplicates(limit?: number): Promise<LibraryDuplicateGroup[]> {
    return this.deps.db.duplicateCandidates(limit)
  }

  /** Files nothing has changed in at least this many days, biggest first. */
  notTouched(days = 180, limit?: number): Promise<LibraryFile[]> {
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
    const files = await this.deps.db.filesNamed(name, size)
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
    if (!(await this.known(path))) return
    const failure = await this.deps.openPath?.(path)
    if (failure !== undefined && failure.length > 0) {
      this.error = `Could not open ${path}: ${failure}`
      await this.publish()
    }
  }

  /** Shows an indexed file in the system's file manager, with the same check as opening. */
  async showInFolder(path: string): Promise<void> {
    if (!(await this.known(path))) return
    try {
      await this.deps.revealPath?.(path)
    } catch (error) {
      this.error = `Could not show ${path}: ${message(error)}`
      await this.publish()
    }
  }

  /** A folder inside an excluded one can't be indexed: every scan would skip it anyway. */
  private async canIndex(path: string): Promise<boolean> {
    const excluded = (await this.deps.db.excludedFolders()).find((folder) =>
      isInsideFolder(path, folder, this.rules.caseInsensitive)
    )
    if (excluded === undefined) return true
    this.error = `${path} is inside the excluded folder ${excluded}. Remove it from Excluded folders first.`
    return false
  }

  /**
   * A running scan uses the exclusions it started with, so changing them mid-scan would put
   * excluded files straight back.
   */
  private refuseWhileScanning(): boolean {
    if (this.scanning === null) return false
    this.error = 'Stop the scan before changing excluded folders.'
    return true
  }

  private async known(path: string): Promise<boolean> {
    // Play history counts too: a shuffle folder isn't necessarily indexed, and the Stats tab lists
    // what played. Either way it is a path the app itself recorded, never one the renderer made up.
    const [indexed, played] = await Promise.all([
      this.deps.db.hasFile(path),
      this.deps.db.hasPlayed(path)
    ])
    if (indexed || played) return true
    // Usually the file was deleted or moved since the last scan, rather than anything sinister.
    this.error = `${path} is not in the index. Scan again if it has moved or changed.`
    await this.publish()
    return false
  }

  /** Indexes every root, one at a time. A second call while scanning joins the running scan. */
  async scanAll(): Promise<void> {
    return this.beginScan()
  }

  /** Indexes one folder again, for example from Settings. Joins a scan already running. */
  async scanRoot(path: string): Promise<void> {
    return this.beginScan(path)
  }

  isScanning(): boolean {
    return this.scanning !== null
  }

  /** Something outside the service changed the index, for example clearing it from Settings. */
  async notifyChanged(): Promise<void> {
    this.invalidateTotals()
    await this.publish()
  }

  private beginScan(only?: string): Promise<void> {
    if (this.scanning !== null) return this.scanning
    if (this.disposed) return Promise.resolve()
    this.scanning = this.runScan(only).finally(async () => {
      this.scanning = null
      this.controller = null
      this.progress = null
      await this.publish().catch(() => undefined)
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

  private async runScan(only?: string): Promise<void> {
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

    const [allRoots, excluded] = await Promise.all([
      this.deps.db.roots(),
      this.deps.db.excludedFolders()
    ])
    const roots = allRoots.filter((root) => only === undefined || root.path === only)
    const rules: SkipRules = { ...this.rules, excluded }

    for (const root of roots) {
      if (controller.signal.aborted) {
        cancelled = true
        break
      }
      let summary: ScanSummary
      try {
        const scanId = await this.deps.db.startScan()
        summary = await this.scan({
          roots: [root.path],
          rules,
          signal: controller.signal,
          // Waiting for each write also holds the scanner back when the index falls behind, so
          // batches can't pile up in memory.
          onBatch: (batch) => this.deps.db.putFiles(scanId, batch),
          onProgress: (progress) => this.reportProgress(progress)
        })

        files += summary.files
        errors += summary.errors.length
        if (summary.cancelled) {
          // A cancelled pass saw only part of the folder, so sweeping would delete files that are
          // still there. Keep what was written and leave the rest of the index alone.
          cancelled = true
          break
        }
        removed += (await this.deps.db.finishRoot(root.path, scanId)).removed
      } catch (error) {
        this.error = `Could not index ${root.path}: ${message(error)}`
        errors += 1
        continue
      } finally {
        // Each finished folder shows up in the totals straight away, not only when all are done.
        // A cancelled or failed pass may have written files too, so the totals are stale either way.
        this.invalidateTotals()
      }
    }

    await this.refreshDriveSpace()
    this.lastScan = { finishedAt: now(), files, removed, errors, cancelled }
    if (errors > 0 && this.error === null) {
      this.error = `${errors} ${errors === 1 ? 'folder' : 'folders'} could not be read and were skipped.`
    }
  }

  /** Indexed drives, plus any drive holding a root that has nothing indexed yet. */
  private async drives(): Promise<LibraryDrive[]> {
    const [totals, roots] = await Promise.all([this.totals(), this.deps.db.roots()])
    const known = new Map<string, LibraryDrive>()
    for (const total of totals.drives) {
      const space = this.space.get(total.drive)
      known.set(total.drive, {
        ...total,
        total: space?.total ?? null,
        free: space?.free ?? null
      })
    }
    for (const root of roots) {
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

  private totals(): Promise<Totals> {
    if (this.cachedTotals === null) {
      const pending = Promise.all([
        this.deps.db.totalsByCategory(),
        this.deps.db.totalsByDrive()
      ]).then(([categories, drives]) => ({ categories, drives }))
      // A failed read isn't kept, so the next view tries again.
      pending.catch(() => {
        if (this.cachedTotals === pending) this.cachedTotals = null
      })
      this.cachedTotals = pending
    }
    return this.cachedTotals
  }

  /** The index changed, so the next view recomputes its totals. */
  private invalidateTotals(): void {
    this.cachedTotals = null
  }

  private reportProgress(progress: ScanProgressView): void {
    this.progress = progress
    const now = (this.deps.now ?? Date.now)()
    if (now - this.lastProgressAt < PROGRESS_EVERY_MS) return
    this.lastProgressAt = now
    this.emit()
  }

  /** Builds the current view, sends it to the window unless a newer one went first, and returns it. */
  private async publish(): Promise<LibraryView> {
    const number = ++this.viewsStarted
    const view = await this.getView()
    if (!this.disposed && number > this.viewsSent) {
      this.viewsSent = number
      for (const listener of [...this.listeners]) listener(view)
    }
    return view
  }

  /** `publish` without waiting, for progress during a scan. A failed view is simply skipped. */
  private emit(): void {
    this.publish().catch(() => undefined)
  }
}
