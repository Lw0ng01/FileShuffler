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
 * Where the app keeps its data, with an override for testing.
 *
 * `FILESHUFFLER_DATA` points the whole app at another folder, which is the only way to try
 * something against a *copy* of a real library rather than the real one - what `CLAUDE.md` asks for
 * when checking behaviour in the running app. Electron resolves `appData` from the operating system
 * rather than from the environment, so setting `APPDATA` does not do it.
 *
 * Same shape as `FILESHUFFLER_MPV`: an escape hatch for the person running the app, never read from
 * anything the app itself stores.
 */
export function dataFolder(
  appDataPath: string,
  packaged: boolean,
  env: NodeJS.ProcessEnv = process.env
): string {
  const override = env['FILESHUFFLER_DATA']
  if (typeof override === 'string' && override.trim() !== '') return override
  return join(appDataPath, dataFolderName(packaged))
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
