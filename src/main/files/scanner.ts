import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { posix, win32, type PlatformPath } from 'node:path'
import {
  categoryOf,
  isExcluded,
  shouldSkipFolder,
  SKIP_MARKER_FILES,
  systemSkipRules,
  type Category,
  type SkipRules
} from './scanRules'

export interface ScanFile {
  /** Absolute path, and the primary key in the index. */
  path: string
  /** The chosen root this file was found under. */
  root: string
  name: string
  folder: string
  /**
   * The volume the file is on: `C:` on Windows, `/` or `/Volumes/<name>` on macOS. Lets the
   * dashboard group by drive without re-parsing paths.
   */
  drive: string
  category: Category
  size: number
  modifiedMs: number
}

export interface ScanProgress {
  folders: number
  files: number
  bytes: number
  /** The folder being read, so the UI can show something is happening. */
  current: string
}

export interface ScanError {
  folder: string
  message: string
}

export interface ScanSummary {
  folders: number
  files: number
  bytes: number
  errors: ScanError[]
  cancelled: boolean
}

export interface ScanOptions {
  roots: readonly string[]
  /** Receives files in batches so the store can write one transaction per batch. */
  onBatch: (files: ScanFile[]) => Promise<void> | void
  onProgress?: (progress: ScanProgress) => void
  signal?: AbortSignal
  batchSize?: number
  concurrency?: number
  /** Guards against a runaway tree; personal folders are nowhere near this deep. */
  maxDepth?: number
  rules?: SkipRules
  /**
   * Which flavour of path to read roots and drives with. Defaults to this machine's; tests set it
   * so Windows paths are classified the same way wherever the tests run.
   */
  platform?: NodeJS.Platform
}

interface Job {
  folder: string
  root: string
  depth: number
}

/**
 * Path handling for one platform's flavour. Defaults to this machine's, so nothing about a real
 * scan changes; passing it explicitly lets Windows paths be read on any machine, exactly as
 * `systemSkipRules` already allows for skip rules.
 */
function pathFor(platform: NodeJS.Platform): PlatformPath {
  return platform === 'win32' ? win32 : posix
}

/** Where macOS mounts every volume other than the startup disk. */
const MAC_VOLUMES = '/Volumes/'

/**
 * Which drive a file counts as being on: `C:` from `C:\Videos\clip.mp4` on Windows, and the volume
 * it is mounted on elsewhere.
 *
 * macOS needs more than the filesystem root, which is `/` for every path. Grouping by that put
 * every external disk on one dashboard card, showing whichever volume's free space happened to be
 * read last (PROJECT.md §7 Phase 4). Mounted volumes live at `/Volumes/<name>`, and that is what
 * tells them apart. `/System/Volumes/...` is deliberately left on `/`: those are firmlinks to the
 * startup disk, not drives of their own.
 *
 * Pure string work on purpose. This runs for every file in a scan, so it must never touch the disk.
 */
export function driveOf(path: string, platform: NodeJS.Platform = process.platform): string {
  const root = pathFor(platform).parse(path).root
  // A relative path belongs to no drive.
  if (root === '') return ''
  if (platform === 'darwin' && path.startsWith(MAC_VOLUMES)) {
    const name = path.slice(MAC_VOLUMES.length).split('/')[0]
    if (name !== undefined && name !== '') return `${MAC_VOLUMES}${name}`
  }
  return root.endsWith('\\') || root.endsWith('/') ? root.slice(0, -1) || root : root
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Reads the chosen folders and everything inside them, collecting indexable files (PROJECT.md §7
 * Phase 3). Read-only: nothing here writes, moves or deletes (§2.1).
 *
 * - Symbolic links and junctions are never followed, so a scan can't loop (§2.6).
 * - System locations, dot-folders and junk folders are skipped, roots included (§2.5).
 * - A folder that can't be read (permissions, a drive pulled mid-scan) is recorded and the scan
 *   carries on: one unreadable folder must never abandon a whole drive.
 * - Work is level by level with bounded concurrency, so a huge tree can't flood the event loop,
 *   and `signal` stops it promptly (§5 Efficiency).
 */
export async function scanRoots(options: ScanOptions): Promise<ScanSummary> {
  const platform = options.platform ?? process.platform
  const paths = pathFor(platform)
  const rules = options.rules ?? systemSkipRules(platform)
  // 2,000 rather than 500: fewer, larger transactions were measurably faster to index (PROJECT.md
  // §7 measure and harden), and each batch is still a small, bounded amount of memory.
  const batchSize = Math.max(1, options.batchSize ?? 2000)
  const concurrency = Math.max(1, options.concurrency ?? 4)
  const maxDepth = Math.max(0, options.maxDepth ?? 24)
  const summary: ScanSummary = { folders: 0, files: 0, bytes: 0, errors: [], cancelled: false }

  let batch: ScanFile[] = []
  /** Keeps onBatch calls in order, so the store never sees two writes at once. */
  let writing: Promise<void> = Promise.resolve()

  const enqueue = (chunk: ScanFile[]): Promise<void> => {
    writing = writing.then(async () => {
      await options.onBatch(chunk)
    })
    return writing
  }

  /** Hands over whole batches only, so one crowded folder can't become a single huge write. */
  const flushFull = async (): Promise<void> => {
    while (batch.length >= batchSize) {
      const ready = batch.slice(0, batchSize)
      batch = batch.slice(batchSize)
      await enqueue(ready)
    }
  }

  const flushRest = async (): Promise<void> => {
    if (batch.length > 0) {
      const ready = batch
      batch = []
      await enqueue(ready)
    }
    await writing
  }

  const cancelled = (): boolean => options.signal?.aborted === true

  async function visit(job: Job, next: Job[]): Promise<void> {
    let entries: Dirent<string>[]
    try {
      entries = await readdir(job.folder, { withFileTypes: true })
    } catch (error) {
      summary.errors.push({ folder: job.folder, message: message(error) })
      return
    }
    summary.folders += 1

    // A virtual environment or similar tool folder: nothing here is personal media.
    if (entries.some((entry) => entry.isFile() && SKIP_MARKER_FILES.has(entry.name))) return

    const found: ScanFile[] = []
    for (const entry of entries) {
      if (cancelled()) break
      // True for symlinks and Windows junctions, which are never followed (§2.6).
      if (entry.isSymbolicLink()) continue
      const full = paths.join(job.folder, entry.name)

      if (entry.isDirectory()) {
        if (job.depth >= maxDepth) continue
        if (shouldSkipFolder(full, entry.name, rules)) continue
        next.push({ folder: full, root: job.root, depth: job.depth + 1 })
        continue
      }
      if (!entry.isFile() || entry.name.startsWith('.')) continue

      const category = categoryOf(entry.name)
      if (category === null) continue
      try {
        const stats = await stat(full)
        found.push({
          path: full,
          root: job.root,
          name: entry.name,
          folder: job.folder,
          drive: driveOf(full, platform),
          category,
          size: stats.size,
          modifiedMs: stats.mtimeMs
        })
        summary.files += 1
        summary.bytes += stats.size
      } catch (error) {
        summary.errors.push({ folder: full, message: message(error) })
      }
    }

    if (found.length > 0) {
      batch.push(...found)
      await flushFull()
    }
    options.onProgress?.({
      folders: summary.folders,
      files: summary.files,
      bytes: summary.bytes,
      current: job.folder
    })
  }

  let level: Job[] = []
  for (const root of options.roots) {
    if (!paths.isAbsolute(root)) {
      summary.errors.push({ folder: root, message: 'Not an absolute path, so it was skipped' })
      continue
    }
    if (isExcluded(root, rules)) {
      summary.errors.push({ folder: root, message: 'Excluded in Settings, so it was skipped' })
      continue
    }
    if (shouldSkipFolder(root, paths.parse(root).base || root, rules)) {
      summary.errors.push({ folder: root, message: 'A system location, so it was skipped' })
      continue
    }
    level.push({ folder: root, root, depth: 0 })
  }

  while (level.length > 0 && !cancelled()) {
    const next: Job[] = []
    let index = 0
    const workers = Array.from({ length: Math.min(concurrency, level.length) }, async () => {
      for (;;) {
        if (cancelled()) return
        const job = level[index++]
        if (job === undefined) return
        await visit(job, next)
      }
    })
    await Promise.all(workers)
    level = next
  }

  await flushRest()
  summary.cancelled = cancelled()
  return summary
}
