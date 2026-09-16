import type { LibraryFile, LibraryView, ScanProgressView } from '../../shared/library'
import type { ScanOptions, ScanSummary } from '../files/scanner'
import { scanRoots } from '../files/scanner'
import type { IndexDb } from '../library/indexDb'

export interface IndexerServiceDeps {
  db: IndexDb
  /** Injected so tests can drive scanning without touching a real filesystem. */
  scan?: (options: ScanOptions) => Promise<ScanSummary>
  /** Folders offered the first time, for example the user's Videos and Pictures. */
  defaultRoots?: () => string[]
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
      drives: this.deps.db.totalsByDrive(),
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

  removeRoot(path: string): LibraryView {
    this.deps.db.removeRoot(path)
    this.emit()
    return this.getView()
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

    this.lastScan = { finishedAt: now(), files, removed, errors, cancelled }
    if (errors > 0 && this.error === null) {
      this.error = `${errors} ${errors === 1 ? 'folder' : 'folders'} could not be read and were skipped.`
    }
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
