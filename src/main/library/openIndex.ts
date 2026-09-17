import { existsSync, renameSync } from 'node:fs'
import { IndexDb } from './indexDb'

/** SQLite's result codes for a file that is damaged or isn't a database at all. */
const SQLITE_CORRUPT = 11
const SQLITE_NOTADB = 26

export interface OpenedIndex {
  db: IndexDb
  /** Where an unreadable index was moved to, or null when the existing one opened normally. */
  setAside: string | null
}

/** True only for errors that say the file itself is unreadable, not that it's busy or locked. */
export function isDamagedDatabase(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { errcode?: unknown }).errcode
  // Extended result codes keep the primary code in their low byte.
  return typeof code === 'number' && [SQLITE_CORRUPT, SQLITE_NOTADB].includes(code & 0xff)
}

/**
 * Opens the index, and if the file is damaged, moves it aside and starts a fresh one, so a bad
 * index can't stop the app from starting. The old file stays beside the new one (PROJECT.md §2).
 * Any journal files still there move with it, because SQLite would otherwise replay another
 * database's journal into the fresh index. (SQLite itself may already have discarded a journal
 * on the failed open; a journal for an unreadable database can't be replayed anyway.)
 *
 * Any other failure (a locked or unwritable file) is thrown, since moving a healthy index aside
 * over a passing problem would lose play history and favorites for nothing.
 */
export function openIndex(
  file: string,
  open: (file: string) => IndexDb = (path) => new IndexDb(path),
  now: () => number = Date.now
): OpenedIndex {
  try {
    return { db: open(file), setAside: null }
  } catch (error) {
    if (!isDamagedDatabase(error) || !existsSync(file)) throw error
    const setAside = `${file}.unreadable-${now()}`
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(file + suffix)) renameSync(file + suffix, setAside + suffix)
    }
    renameSync(file, setAside)
    return { db: open(file), setAside }
  }
}
