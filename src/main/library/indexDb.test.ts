import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ScanFile } from '../files/scanner'
import { IndexDb } from './indexDb'

function file(path: string, overrides: Partial<ScanFile> = {}): ScanFile {
  return {
    path,
    root: 'D:\\Media',
    name: path.split('\\').pop() as string,
    folder: path.split('\\').slice(0, -1).join('\\'),
    drive: 'D:',
    category: 'video',
    size: 100,
    modifiedMs: 1_000,
    ...overrides
  }
}

describe('IndexDb', () => {
  let db: IndexDb

  beforeEach(() => {
    db = new IndexDb(':memory:')
    db.addRoot('D:\\Media')
  })

  afterEach(() => {
    db.close()
  })

  it('stores files and totals them by category and drive', () => {
    const scan = db.startScan()
    db.putFiles(scan, [
      file('D:\\Media\\a.mp4', { size: 500 }),
      file('D:\\Media\\b.jpg', { category: 'photo', size: 50 }),
      file('C:\\Users\\me\\c.pdf', { category: 'document', size: 25, drive: 'C:' })
    ])

    expect(db.fileCount()).toBe(3)
    expect(db.totalsByCategory()).toEqual([
      { category: 'video', files: 1, bytes: 500 },
      { category: 'photo', files: 1, bytes: 50 },
      { category: 'document', files: 1, bytes: 25 }
    ])
    expect(db.totalsByDrive()).toEqual([
      { drive: 'D:', files: 2, bytes: 550 },
      { drive: 'C:', files: 1, bytes: 25 }
    ])
  })

  it('updates a file that changed instead of storing it twice', () => {
    const first = db.startScan()
    db.putFiles(first, [file('D:\\Media\\a.mp4', { size: 100, modifiedMs: 1 })])

    const second = db.startScan()
    db.putFiles(second, [file('D:\\Media\\a.mp4', { size: 900, modifiedMs: 2 })])

    expect(db.fileCount()).toBe(1)
    expect(db.largest(5)[0]).toMatchObject({ path: 'D:\\Media\\a.mp4', size: 900 })
  })

  it('forgets files a rescan no longer finds, leaving other roots alone', () => {
    db.addRoot('E:\\Photos')
    const first = db.startScan()
    db.putFiles(first, [
      file('D:\\Media\\stays.mp4'),
      file('D:\\Media\\deleted.mp4'),
      file('E:\\Photos\\other.jpg', { root: 'E:\\Photos', category: 'photo', drive: 'E:' })
    ])
    db.finishRoot('D:\\Media', first)
    db.finishRoot('E:\\Photos', first)
    expect(db.fileCount()).toBe(3)

    const second = db.startScan()
    db.putFiles(second, [file('D:\\Media\\stays.mp4')])
    expect(db.finishRoot('D:\\Media', second)).toEqual({ removed: 1 })

    expect(db.fileCount()).toBe(2)
    expect(
      db
        .largest(10)
        .map((row) => row.name)
        .sort()
    ).toEqual(['other.jpg', 'stays.mp4'])
  })

  it('records when a root was last scanned, with its totals', () => {
    const scan = db.startScan()
    db.putFiles(scan, [
      file('D:\\Media\\a.mp4', { size: 7 }),
      file('D:\\Media\\b.mp4', { size: 3 })
    ])
    db.finishRoot('D:\\Media', scan)

    const root = db.roots().find((entry) => entry.path === 'D:\\Media')
    expect(root).toMatchObject({ files: 2, bytes: 10 })
    expect(root?.lastScanAt).toBeGreaterThan(0)
  })

  it('ranks folders by how much they hold', () => {
    const scan = db.startScan()
    db.putFiles(scan, [
      file('D:\\Media\\films\\big.mp4', { size: 900 }),
      file('D:\\Media\\films\\also.mp4', { size: 50 }),
      file('D:\\Media\\clips\\small.mp4', { size: 10 })
    ])

    expect(db.biggestFolders(5)).toEqual([
      { folder: 'D:\\Media\\films', drive: 'D:', files: 2, bytes: 950 },
      { folder: 'D:\\Media\\clips', drive: 'D:', files: 1, bytes: 10 }
    ])
  })

  it('groups files that share a name and size, worst waste first', () => {
    const scan = db.startScan()
    db.putFiles(scan, [
      file('D:\\Media\\a\\holiday.mp4', { size: 100 }),
      file('D:\\Media\\b\\holiday.mp4', { size: 100 }),
      file('D:\\Media\\c\\holiday.mp4', { size: 100 }),
      file('D:\\Media\\a\\song.mp3', { size: 500, category: 'audio' }),
      file('D:\\Media\\b\\song.mp3', { size: 500, category: 'audio' }),
      file('D:\\Media\\a\\unique.mp4', { size: 700 }),
      // Same name but a different size, so not a candidate.
      file('D:\\Media\\b\\unique.mp4', { size: 701 })
    ])

    const groups = db.duplicateCandidates(10)
    expect(groups.map((group) => [group.name, group.files.length, group.wastedBytes])).toEqual([
      ['song.mp3', 2, 500],
      ['holiday.mp4', 3, 200]
    ])
    expect(groups[1]?.files.map((row) => row.path)).toEqual([
      'D:\\Media\\a\\holiday.mp4',
      'D:\\Media\\b\\holiday.mp4',
      'D:\\Media\\c\\holiday.mp4'
    ])
  })

  it('ignores empty files when looking for duplicates', () => {
    const scan = db.startScan()
    db.putFiles(scan, [
      file('D:\\Media\\a\\empty.mp4', { size: 0 }),
      file('D:\\Media\\b\\empty.mp4', { size: 0 })
    ])
    expect(db.duplicateCandidates(10)).toEqual([])
  })

  it('lists big files nothing has changed in a long time', () => {
    const scan = db.startScan()
    db.putFiles(scan, [
      file('D:\\Media\\old-big.mp4', { size: 900, modifiedMs: 1_000 }),
      file('D:\\Media\\old-small.mp4', { size: 5, modifiedMs: 1_000 }),
      file('D:\\Media\\new.mp4', { size: 950, modifiedMs: 9_000 })
    ])

    expect(db.notTouchedSince(5_000, 10).map((row) => row.name)).toEqual([
      'old-big.mp4',
      'old-small.mp4'
    ])
  })

  it('knows whether a path is in the index', () => {
    const scan = db.startScan()
    db.putFiles(scan, [file('D:\\Media\\a.mp4')])

    expect(db.hasFile('D:\\Media\\a.mp4')).toBe(true)
    expect(db.hasFile('D:\\Media\\other.mp4')).toBe(false)
    expect(db.hasFile('C:\\Windows\\System32\\cmd.exe')).toBe(false)
  })

  it('removes a root and everything indexed under it', () => {
    const scan = db.startScan()
    db.putFiles(scan, [file('D:\\Media\\a.mp4')])
    db.removeRoot('D:\\Media')

    expect(db.roots()).toEqual([])
    expect(db.fileCount()).toBe(0)
  })

  it('lists the largest and the most recent files', () => {
    const scan = db.startScan()
    db.putFiles(scan, [
      file('D:\\Media\\small.mp4', { size: 1, modifiedMs: 300 }),
      file('D:\\Media\\huge.mp4', { size: 900, modifiedMs: 100 }),
      file('D:\\Media\\middle.mp4', { size: 50, modifiedMs: 200 })
    ])

    expect(db.largest(2).map((row) => row.name)).toEqual(['huge.mp4', 'middle.mp4'])
    expect(db.recent(2).map((row) => row.name)).toEqual(['small.mp4', 'middle.mp4'])
  })

  it('searches names, ignoring case, and treats wildcards as plain text', () => {
    const scan = db.startScan()
    db.putFiles(scan, [
      file('D:\\Media\\Holiday Beach.mp4'),
      file('D:\\Media\\100% done.mp4'),
      file('D:\\Media\\other.mp4')
    ])

    expect(db.search('beach').map((row) => row.name)).toEqual(['Holiday Beach.mp4'])
    expect(db.search('100%').map((row) => row.name)).toEqual(['100% done.mp4'])
    expect(db.search('%').map((row) => row.name)).toEqual(['100% done.mp4'])
    expect(db.search('  ')).toEqual([])
  })
})

describe('IndexDb on disk', () => {
  let folder: string

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'fileshuffler-index-'))
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  it('keeps the index across restarts, creating the folder it needs', () => {
    const path = join(folder, 'nested', 'index.db')
    const first = new IndexDb(path)
    first.addRoot('D:\\Media')
    const scan = first.startScan()
    first.putFiles(scan, [file('D:\\Media\\a.mp4', { size: 42 })])
    first.finishRoot('D:\\Media', scan)
    first.close()

    const second = new IndexDb(path)
    expect(second.fileCount()).toBe(1)
    expect(second.roots()[0]).toMatchObject({ path: 'D:\\Media', files: 1, bytes: 42 })
    second.close()
  })
})
