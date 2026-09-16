import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { Category } from '../files/scanRules'
import type { ScanFile } from '../files/scanner'

/**
 * The indexer's store (PROJECT.md §7 Phase 3), on Node's built-in SQLite: no native dependency to
 * rebuild for Electron and nothing extra to approve in `allowScripts` (§5).
 *
 * It holds only what the dashboard needs — paths, sizes and dates of personal media and documents.
 * The file lives in the app's data folder and never leaves the machine (§2.7–2.8).
 */
const SCHEMA = `
  create table if not exists roots (
    path text primary key,
    added_at integer not null,
    last_scan_at integer,
    files integer not null default 0,
    bytes integer not null default 0
  );
  create table if not exists files (
    path text primary key,
    root text not null,
    name text not null,
    folder text not null,
    drive text not null,
    category text not null,
    size integer not null,
    modified_ms integer not null,
    seen_scan integer not null
  );
  create index if not exists files_root on files(root);
  create index if not exists files_category on files(category);
  create index if not exists files_size on files(size desc);
  create index if not exists files_modified on files(modified_ms desc);
  create index if not exists files_name_size on files(name, size);
  create table if not exists plays (
    id integer primary key autoincrement,
    path text not null,
    name text not null,
    folder text not null,
    opened_at integer not null,
    ended_at integer
  );
  create index if not exists plays_path on plays(path);
  create index if not exists plays_opened on plays(opened_at desc);
  create table if not exists favorites (
    path text primary key,
    name text not null,
    folder text not null,
    added_at integer not null
  );
`

export interface RootRow {
  path: string
  addedAt: number
  lastScanAt: number | null
  files: number
  bytes: number
}

export interface CategoryTotal {
  category: Category
  files: number
  bytes: number
}

export interface DriveTotal {
  drive: string
  files: number
  bytes: number
}

export interface FileRow {
  path: string
  name: string
  folder: string
  drive: string
  category: Category
  size: number
  modifiedMs: number
}

export interface FolderTotal {
  folder: string
  drive: string
  files: number
  bytes: number
}

export interface DuplicateGroup {
  name: string
  size: number
  files: FileRow[]
  /** What deleting all but one copy would free. */
  wastedBytes: number
}

export interface PlayedFile {
  path: string
  name: string
  folder: string
  /** Times the player confirmed it opened. */
  plays: number
  /** Of those, how many reached the end rather than being skipped. */
  finished: number
  lastPlayedAt: number
}

export interface PlayTotals {
  plays: number
  finished: number
  /** Different files played. */
  files: number
  /** When history starts, or null if nothing has played yet. */
  since: number | null
}

export interface FavoriteRow {
  path: string
  name: string
  folder: string
  addedAt: number
}

export type FileSort = 'size' | 'modified' | 'name'

/** A filtered, sorted page of indexed files. Every field is optional. */
export interface FileQuery {
  /** Part of the file name. */
  term?: string
  categories?: readonly Category[]
  drives?: readonly string[]
  minSize?: number
  maxSize?: number
  sort?: FileSort
  direction?: 'asc' | 'desc'
  offset?: number
  limit?: number
}

export interface FilePage {
  rows: FileRow[]
  /** Every file matching the filters, not just this page. */
  total: number
}

/**
 * The only columns a query can sort by. Sorting is chosen from this table, never from text the
 * renderer sends, so a query can't carry SQL of its own.
 */
const SORT_COLUMNS: Record<FileSort, string> = {
  size: 'size',
  modified: 'modified_ms',
  name: 'name collate nocase'
}

/** Rows one query may return. Enough for "show more" without loading a whole library at once. */
const MAX_PAGE = 500

type Row = Record<string, unknown>

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function count(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : 0
}

function toFileRow(row: Row): FileRow {
  return {
    path: text(row['path']),
    name: text(row['name']),
    folder: text(row['folder']),
    drive: text(row['drive']),
    category: text(row['category']) as Category,
    size: count(row['size']),
    modifiedMs: count(row['modified_ms'])
  }
}

/** Escapes the wildcards SQLite's LIKE understands, so a search for "100%" finds that text. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

export class IndexDb {
  private readonly db: DatabaseSync
  private insertFile: StatementSync | null = null
  private markSeen: StatementSync | null = null

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    try {
      // WAL keeps reads working while a scan writes; NORMAL is the usual pairing and survives a
      // crash losing at most the last transaction, which a rescan rebuilds anyway.
      this.db.exec('pragma journal_mode = wal; pragma synchronous = normal;')
      // Measured on a synthetic 250,000-file library (PROJECT.md §7 measure and harden): a 64 MB
      // page cache and in-memory temporary tables, with the scanner's larger batches, cut a first
      // index from 30 s to 12 s and a rescan from 19 s to 10 s, and halved most dashboard queries.
      this.db.exec('pragma cache_size = -65536; pragma temp_store = memory;')
      this.db.exec(SCHEMA)
    } catch (error) {
      // A damaged file opens without complaint and fails here. Let go of it, so Windows allows
      // it to be set aside (openIndex.ts).
      this.db.close()
      throw error
    }
  }

  addRoot(path: string): void {
    this.db
      .prepare('insert or ignore into roots (path, added_at) values (?, ?)')
      .run(path, Date.now())
  }

  /** Forgets a root and everything indexed under it. */
  removeRoot(path: string): void {
    this.db.exec('begin')
    try {
      this.db.prepare('delete from files where root = ?').run(path)
      this.db.prepare('delete from roots where path = ?').run(path)
      this.db.exec('commit')
    } catch (error) {
      this.db.exec('rollback')
      throw error
    }
  }

  roots(): RootRow[] {
    return this.db
      .prepare('select * from roots order by path')
      .all()
      .map((row) => {
        const entry = row as Row
        const lastScan = entry['last_scan_at']
        return {
          path: text(entry['path']),
          addedAt: count(entry['added_at']),
          lastScanAt: lastScan === null || lastScan === undefined ? null : count(lastScan),
          files: count(entry['files']),
          bytes: count(entry['bytes'])
        }
      })
  }

  /**
   * Identifies one pass over a root, so `finishRoot` can sweep away what it didn't see. Always
   * higher than any id already stored: two scans inside the same millisecond, or a clock stepping
   * backwards, would otherwise share an id and the sweep would quietly delete nothing.
   */
  startScan(): number {
    const row = this.db.prepare('select coalesce(max(seen_scan), 0) as last from files').get() as
      Row | undefined
    const last = row === undefined ? 0 : count(row['last'])
    return Math.max(Date.now(), last + 1)
  }

  /**
   * Adds or updates a batch in one transaction. Files keep their path as identity.
   *
   * A file is only rewritten when something about it changed; an unchanged one just gets its
   * "seen in this scan" mark. Most files are unchanged between scans, and rewriting every column
   * also rewrites every index entry: measured on 250,000 files, this cut a rescan from 17 s to 2 s
   * (PROJECT.md §7 measure and harden).
   */
  putFiles(scanId: number, files: readonly ScanFile[]): void {
    if (files.length === 0) return
    this.insertFile ??= this.db.prepare(`
      insert into files (path, root, name, folder, drive, category, size, modified_ms, seen_scan)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(path) do update set
        root = excluded.root,
        name = excluded.name,
        folder = excluded.folder,
        drive = excluded.drive,
        category = excluded.category,
        size = excluded.size,
        modified_ms = excluded.modified_ms,
        seen_scan = excluded.seen_scan
      where files.size != excluded.size
        or files.modified_ms != excluded.modified_ms
        or files.name != excluded.name
        or files.root != excluded.root
        or files.folder != excluded.folder
        or files.category != excluded.category
    `)
    // No index covers seen_scan, so marking an unchanged file touches no index at all.
    this.markSeen ??= this.db.prepare(
      'update files set seen_scan = ? where path = ? and seen_scan != ?'
    )
    const insert = this.insertFile
    const seen = this.markSeen
    this.db.exec('begin')
    try {
      for (const file of files) {
        insert.run(
          file.path,
          file.root,
          file.name,
          file.folder,
          file.drive,
          file.category,
          Math.round(file.size),
          Math.round(file.modifiedMs),
          scanId
        )
        seen.run(scanId, file.path, scanId)
      }
      this.db.exec('commit')
    } catch (error) {
      this.db.exec('rollback')
      throw error
    }
  }

  /**
   * Ends a pass: anything under this root the scan didn't see is gone from disk, so it goes from
   * the index too. Returns how many rows that removed.
   */
  finishRoot(root: string, scanId: number): { removed: number } {
    const removed = this.db
      .prepare('delete from files where root = ? and seen_scan != ?')
      .run(root, scanId)
    this.db
      .prepare(
        `update roots set
           last_scan_at = ?,
           files = (select count(*) from files where root = ?),
           bytes = (select coalesce(sum(size), 0) from files where root = ?)
         where path = ?`
      )
      .run(Date.now(), root, root, root)
    return { removed: count(removed.changes) }
  }

  totalsByCategory(): CategoryTotal[] {
    return this.db
      .prepare(
        `select category, count(*) as files, coalesce(sum(size), 0) as bytes
         from files group by category order by bytes desc`
      )
      .all()
      .map((row) => {
        const entry = row as Row
        return {
          category: text(entry['category']) as Category,
          files: count(entry['files']),
          bytes: count(entry['bytes'])
        }
      })
  }

  totalsByDrive(): DriveTotal[] {
    return this.db
      .prepare(
        `select drive, count(*) as files, coalesce(sum(size), 0) as bytes
         from files group by drive order by bytes desc`
      )
      .all()
      .map((row) => {
        const entry = row as Row
        return {
          drive: text(entry['drive']),
          files: count(entry['files']),
          bytes: count(entry['bytes'])
        }
      })
  }

  largest(limit = 20): FileRow[] {
    return this.db
      .prepare('select * from files order by size desc, path limit ?')
      .all(Math.max(1, Math.trunc(limit)))
      .map((row) => toFileRow(row as Row))
  }

  recent(limit = 20): FileRow[] {
    return this.db
      .prepare('select * from files order by modified_ms desc, path limit ?')
      .all(Math.max(1, Math.trunc(limit)))
      .map((row) => toFileRow(row as Row))
  }

  /**
   * Files matching every given filter, sorted and paged, with the total that match. Filters are
   * bound as parameters and the sort comes from `SORT_COLUMNS`, so nothing from the query is ever
   * spliced into the SQL text.
   */
  queryFiles(query: FileQuery = {}): FilePage {
    const where: string[] = []
    const params: (string | number)[] = []

    const term = query.term?.trim() ?? ''
    if (term.length > 0) {
      where.push(`name like ? escape '\\'`)
      params.push(likePattern(term))
    }
    if (query.categories !== undefined && query.categories.length > 0) {
      where.push(`category in (${query.categories.map(() => '?').join(', ')})`)
      params.push(...query.categories)
    }
    if (query.drives !== undefined && query.drives.length > 0) {
      where.push(`drive in (${query.drives.map(() => '?').join(', ')})`)
      params.push(...query.drives)
    }
    if (query.minSize !== undefined) {
      where.push('size >= ?')
      params.push(Math.max(0, Math.trunc(query.minSize)))
    }
    if (query.maxSize !== undefined) {
      where.push('size <= ?')
      params.push(Math.max(0, Math.trunc(query.maxSize)))
    }

    const clause = where.length > 0 ? `where ${where.join(' and ')}` : ''
    const column = SORT_COLUMNS[query.sort ?? 'modified']
    const direction = query.direction === 'asc' ? 'asc' : 'desc'
    const limit = Math.min(MAX_PAGE, Math.max(1, Math.trunc(query.limit ?? 50)))
    const offset = Math.max(0, Math.trunc(query.offset ?? 0))

    const totalRow = this.db
      .prepare(`select count(*) as total from files ${clause}`)
      .get(...params) as Row | undefined
    const rows = this.db
      .prepare(
        `select * from files ${clause} order by ${column} ${direction}, path limit ? offset ?`
      )
      .all(...params, limit, offset)
      .map((row) => toFileRow(row as Row))

    return { rows, total: count(totalRow?.['total']) }
  }

  /** Name search. SQLite's LIKE ignores case for ASCII; other alphabets match exactly. */
  search(term: string, limit = 50): FileRow[] {
    if (term.trim().length === 0) return []
    return this.db
      .prepare(
        `select * from files where name like ? escape '\\'
         order by modified_ms desc, path limit ?`
      )
      .all(likePattern(term.trim()), Math.max(1, Math.trunc(limit)))
      .map((row) => toFileRow(row as Row))
  }

  /** Folders holding the most indexed data, for "where has the space gone" (§7 Phase 5). */
  biggestFolders(limit = 12): FolderTotal[] {
    return this.db
      .prepare(
        `select folder, drive, count(*) as files, coalesce(sum(size), 0) as bytes
         from files group by folder order by bytes desc, folder limit ?`
      )
      .all(Math.max(1, Math.trunc(limit)))
      .map((row) => {
        const entry = row as Row
        return {
          folder: text(entry['folder']),
          drive: text(entry['drive']),
          files: count(entry['files']),
          bytes: count(entry['bytes'])
        }
      })
  }

  /**
   * Files sharing a name and a size, biggest waste first. These only *look* like copies: nothing
   * here reads the files, so the UI must say so and a check can confirm it (`fileDigest`).
   */
  duplicateCandidates(limit = 25): DuplicateGroup[] {
    const groups = this.db
      .prepare(
        `select name, size, count(*) as copies
         from files where size > 0
         group by name, size having copies > 1
         order by size * (copies - 1) desc, name limit ?`
      )
      .all(Math.max(1, Math.trunc(limit)))

    return groups.map((row) => {
      const entry = row as Row
      const name = text(entry['name'])
      const size = count(entry['size'])
      const files = this.filesNamed(name, size)
      return { name, size, files, wastedBytes: size * Math.max(0, files.length - 1) }
    })
  }

  /** Every indexed file with this exact name and size. */
  filesNamed(name: string, size: number): FileRow[] {
    return this.db
      .prepare('select * from files where name = ? and size = ? order by path')
      .all(name, Math.round(size))
      .map((row) => toFileRow(row as Row))
  }

  /** Big files nothing has changed in a long time: the usual cleanup candidates. */
  notTouchedSince(before: number, limit = 20): FileRow[] {
    return this.db
      .prepare('select * from files where modified_ms < ? order by size desc, path limit ?')
      .all(Math.trunc(before), Math.max(1, Math.trunc(limit)))
      .map((row) => toFileRow(row as Row))
  }

  /** A play the player confirmed opened (PROJECT.md §7 Phase 5 stats). */
  recordOpened(path: string, name: string, folder: string, at: number = Date.now()): void {
    this.db
      .prepare('insert into plays (path, name, folder, opened_at) values (?, ?, ?, ?)')
      .run(path, name, folder, Math.trunc(at))
  }

  /**
   * Marks a file's latest play as finished. Only the latest: replaying something and skipping it
   * must not turn an earlier skip into a finish.
   */
  recordFinished(path: string, at: number = Date.now()): void {
    this.db
      .prepare(
        `update plays set ended_at = ?
         where id = (select id from plays where path = ? order by opened_at desc, id desc limit 1)
           and ended_at is null`
      )
      .run(Math.trunc(at), path)
  }

  mostPlayed(limit = 20): PlayedFile[] {
    return this.playedFiles('plays desc, last_played desc, path', limit)
  }

  recentlyPlayed(limit = 20): PlayedFile[] {
    return this.playedFiles('last_played desc, path', limit)
  }

  /**
   * Indexed videos with no play on record. Newest first by default; biggest first or A to Z on
   * request, with the direction that makes sense for each.
   */
  neverPlayed(limit = 20, sort: FileSort = 'modified'): FileRow[] {
    const order =
      sort === 'size'
        ? 'f.size desc'
        : sort === 'name'
          ? 'f.name collate nocase asc'
          : 'f.modified_ms desc'
    return this.db
      .prepare(
        `select * from files f
         where f.category = 'video' and not exists (select 1 from plays p where p.path = f.path)
         order by ${order}, f.path limit ?`
      )
      .all(Math.max(1, Math.trunc(limit)))
      .map((row) => toFileRow(row as Row))
  }

  playTotals(): PlayTotals {
    const row = this.db
      .prepare(
        `select count(*) as plays, coalesce(sum(ended_at is not null), 0) as finished,
                count(distinct path) as files, min(opened_at) as since
         from plays`
      )
      .get() as Row | undefined
    const since = row?.['since']
    return {
      plays: count(row?.['plays']),
      finished: count(row?.['finished']),
      files: count(row?.['files']),
      since: since === null || since === undefined ? null : count(since)
    }
  }

  /**
   * Name and folder for a path the app knows, from the index or play history, or null. Shuffle
   * folders aren't necessarily indexed, so play history counts as knowing a file too.
   */
  describeFile(path: string): { name: string; folder: string } | null {
    const row = this.db
      .prepare(
        `select name, folder from files where path = ?
         union all
         select name, folder from plays where path = ?
         limit 1`
      )
      .get(path, path) as Row | undefined
    return row === undefined ? null : { name: text(row['name']), folder: text(row['folder']) }
  }

  hasPlayed(path: string): boolean {
    return this.db.prepare('select 1 from plays where path = ? limit 1').get(path) !== undefined
  }

  /** Stars a file. Starring it again keeps the original date. */
  addFavorite(path: string, name: string, folder: string, at: number = Date.now()): void {
    this.db
      .prepare('insert or ignore into favorites (path, name, folder, added_at) values (?, ?, ?, ?)')
      .run(path, name, folder, Math.trunc(at))
  }

  removeFavorite(path: string): void {
    this.db.prepare('delete from favorites where path = ?').run(path)
  }

  favorites(limit = 200): FavoriteRow[] {
    return this.db
      .prepare('select * from favorites order by added_at desc, path limit ?')
      .all(Math.max(1, Math.trunc(limit)))
      .map((row) => {
        const entry = row as Row
        return {
          path: text(entry['path']),
          name: text(entry['name']),
          folder: text(entry['folder']),
          addedAt: count(entry['added_at'])
        }
      })
  }

  /** `order` is one of the fixed clauses above, never text from the renderer. */
  private playedFiles(order: string, limit: number): PlayedFile[] {
    return this.db
      .prepare(
        `select path, max(name) as name, max(folder) as folder, count(*) as plays,
                coalesce(sum(ended_at is not null), 0) as finished, max(opened_at) as last_played
         from plays group by path order by ${order} limit ?`
      )
      .all(Math.max(1, Math.trunc(limit)))
      .map((row) => {
        const entry = row as Row
        return {
          path: text(entry['path']),
          name: text(entry['name']),
          folder: text(entry['folder']),
          plays: count(entry['plays']),
          finished: count(entry['finished']),
          lastPlayedAt: count(entry['last_played'])
        }
      })
  }

  /** Forgets every recorded play (§6 Settings). Favorites and the index stay. */
  clearPlays(): void {
    this.db.exec('delete from plays')
  }

  /** Forgets every favorite. Play history and the index stay. */
  clearFavorites(): void {
    this.db.exec('delete from favorites')
  }

  /**
   * Forgets every indexed file but keeps the folder list, so one scan rebuilds it. Each folder's
   * totals and last-scanned time reset too, because they described the files just removed.
   */
  clearIndex(): void {
    this.db.exec('begin')
    try {
      this.db.exec('delete from files')
      this.db.exec('update roots set files = 0, bytes = 0, last_scan_at = null')
      this.db.exec('commit')
    } catch (error) {
      this.db.exec('rollback')
      throw error
    }
  }

  /** Whether this exact path is in the index. Guards opening a file the app never catalogued. */
  hasFile(path: string): boolean {
    return this.db.prepare('select 1 from files where path = ?').get(path) !== undefined
  }

  fileCount(): number {
    const row = this.db.prepare('select count(*) as files from files').get() as Row | undefined
    return row === undefined ? 0 : count(row['files'])
  }

  close(): void {
    this.insertFile = null
    this.markSeen = null
    this.db.close()
  }
}
