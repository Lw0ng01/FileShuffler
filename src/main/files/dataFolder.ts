import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The files FileShuffler writes itself. Electron keeps its own caches in the same folder; those
 * are left behind, because they rebuild themselves.
 */
export const APP_DATA_FILES = [
  'index.db',
  'index.db-wal',
  'index.db-shm',
  'progress.json',
  'settings.json'
] as const

/**
 * The folder name inside the system's app-data location (PROJECT.md §7 Phase 6). The installed app
 * and development runs keep separate data, so trying things out in development never touches a
 * real library. Lucas chose this on 2026-09-16.
 */
export function dataFolderName(packaged: boolean): string {
  return packaged ? 'FileShuffler' : 'FileShuffler Dev'
}

/**
 * Copies FileShuffler's own files from an older data folder into a new one, once: only when the
 * new folder has no index yet and the old folder has something to bring. Copies rather than
 * moves, so the old folder stays behind as a backup. Returns the names copied.
 *
 * Synchronous on purpose: it runs once at startup, before the database opens and before any
 * window exists, so there is nothing to block, and the database must not open half-way through.
 */
export function copyLegacyData(from: string, to: string): string[] {
  if (existsSync(join(to, 'index.db'))) return []
  const present = APP_DATA_FILES.filter((name) => existsSync(join(from, name)))
  if (present.length === 0) return []

  mkdirSync(to, { recursive: true })
  for (const name of present) copyFileSync(join(from, name), join(to, name))
  return present
}
