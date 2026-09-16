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

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    // WAL keeps reads working while a scan writes; NORMAL is the usual pairing and survives a
    // crash losing at most the last transaction, which a rescan rebuilds anyway.
    this.db.exec('pragma journal_mode = wal; pragma synchronous = normal;')
    this.db.exec(SCHEMA)
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

  /** Adds or updates a batch in one transaction. Files keep their path as identity. */
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
    `)
    const insert = this.insertFile
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
    this.db.close()
  }
}
