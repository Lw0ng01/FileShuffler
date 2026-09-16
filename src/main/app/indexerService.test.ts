import { describe, expect, it, vi, type Mock } from 'vitest'
import type { LibraryView } from '../../shared/library'
import type { ScanFile, ScanOptions, ScanSummary } from '../files/scanner'
import { IndexDb } from '../library/indexDb'
import { IndexerService, type IndexerServiceDeps } from './indexerService'

function scanFile(path: string, root: string, overrides: Partial<ScanFile> = {}): ScanFile {
  return {
    path,
    root,
    name: path.split('\\').pop() as string,
    folder: root,
    drive: 'D:',
    category: 'video',
    size: 10,
    modifiedMs: 1,
    ...overrides
  }
}

/** A scan that hands over whatever files the test says each root holds. */
function fakeScan(
  contents: Record<string, ScanFile[]>,
  summary: Partial<ScanSummary> = {}
): Mock<(options: ScanOptions) => Promise<ScanSummary>> {
  return vi.fn(async (options: ScanOptions): Promise<ScanSummary> => {
    const root = options.roots[0] as string
    const files = contents[root] ?? []
    options.onProgress?.({ folders: 1, files: files.length, bytes: 0, current: root })
    if (files.length > 0) await options.onBatch(files)
    return {
      folders: 1,
      files: files.length,
      bytes: files.reduce((total, file) => total + file.size, 0),
      errors: [],
      cancelled: false,
      ...summary
    }
  })
}

function setup(deps: Partial<IndexerServiceDeps> = {}): {
  service: IndexerService
  db: IndexDb
  views: LibraryView[]
} {
  const db = new IndexDb(':memory:')
  const service = new IndexerService({ db, scan: fakeScan({}), ...deps })
  const views: LibraryView[] = []
  service.onView((view) => views.push(view))
  return { service, db, views }
}

describe('IndexerService drives and folder picking', () => {
  it('indexes the folder the picker returns', async () => {
    const pickFolder = vi.fn(async () => 'D:\\Videos')
    const { service } = setup({ pickFolder })

    await service.chooseRoot()
    expect(service.getView().roots.map((root) => root.path)).toEqual(['D:\\Videos'])
  })

  it('changes nothing when the picker is cancelled', async () => {
    const pickFolder = vi.fn(async () => null)
    const { service } = setup({ pickFolder })

    await service.chooseRoot()
    expect(pickFolder).toHaveBeenCalledTimes(1)
    expect(service.getView().roots).toEqual([])
  })

  it('shows each drive’s size and free space alongside what was indexed', async () => {
    const scan = fakeScan({
      'D:\\Videos': [scanFile('D:\\Videos\\a.mp4', 'D:\\Videos', { size: 8 })]
    })
    const { service } = setup({
      scan,
      driveSpace: async () => ({ total: 1000, free: 400 })
    })
    service.addRoot('D:\\Videos')
    await service.scanAll()

    expect(service.getView().drives).toEqual([
      { drive: 'D:', files: 1, bytes: 8, total: 1000, free: 400 }
    ])
  })

  it('lists a drive that has a root but nothing indexed yet', async () => {
    const { service } = setup({ driveSpace: async () => ({ total: 500, free: 100 }) })
    service.addRoot('E:\\Photos')
    await service.refreshDriveSpace()

    expect(service.getView().drives).toEqual([
      { drive: 'E:', files: 0, bytes: 0, total: 500, free: 100 }
    ])
  })

  it('leaves capacity empty when a drive cannot be read, rather than failing', async () => {
    const { service } = setup({ driveSpace: async () => null })
    service.addRoot('Z:\\Unplugged')
    await service.refreshDriveSpace()

    expect(service.getView().drives).toEqual([
      { drive: 'Z:', files: 0, bytes: 0, total: null, free: null }
    ])
  })
})

describe('IndexerService', () => {
  it('starts empty and offers the default folders only when nothing is indexed', () => {
    const { service, db } = setup({ defaultRoots: () => ['D:\\Videos', 'D:\\Pictures'] })
    expect(service.getView()).toMatchObject({ status: 'idle', roots: [], files: 0, bytes: 0 })

    service.addDefaultRoots()
    expect(service.getView().roots.map((root) => root.path)).toEqual(['D:\\Pictures', 'D:\\Videos'])

    db.addRoot('E:\\More')
    service.addDefaultRoots()
    expect(service.getView().roots).toHaveLength(3)
  })

  it('indexes each root and totals what it found', async () => {
    const scan = fakeScan({
      'D:\\Videos': [scanFile('D:\\Videos\\a.mp4', 'D:\\Videos', { size: 100 })],
      'D:\\Pictures': [
        scanFile('D:\\Pictures\\b.jpg', 'D:\\Pictures', { category: 'photo', size: 20 })
      ]
    })
    const { service } = setup({ scan })
    service.addRoot('D:\\Videos')
    service.addRoot('D:\\Pictures')

    await service.scanAll()

    const view = service.getView()
    expect(scan).toHaveBeenCalledTimes(2)
    expect(view).toMatchObject({ status: 'idle', files: 2, bytes: 120, progress: null })
    expect(view.totals).toEqual([
      { category: 'video', files: 1, bytes: 100 },
      { category: 'photo', files: 1, bytes: 20 }
    ])
    expect(view.lastScan).toMatchObject({ files: 2, removed: 0, errors: 0, cancelled: false })
    expect(view.roots.every((root) => root.lastScanAt !== null)).toBe(true)
  })

  it('drops files a later scan no longer finds', async () => {
    const first = fakeScan({
      'D:\\Videos': [
        scanFile('D:\\Videos\\stays.mp4', 'D:\\Videos'),
        scanFile('D:\\Videos\\gone.mp4', 'D:\\Videos')
      ]
    })
    const { service, db } = setup({ scan: first })
    service.addRoot('D:\\Videos')
    await service.scanAll()
    expect(db.fileCount()).toBe(2)

    const second = fakeScan({ 'D:\\Videos': [scanFile('D:\\Videos\\stays.mp4', 'D:\\Videos')] })
    const resumed = new IndexerService({ db, scan: second })
    await resumed.scanAll()

    expect(db.fileCount()).toBe(1)
    expect(resumed.getView().lastScan).toMatchObject({ removed: 1 })
  })

  it('keeps what a cancelled scan found without treating the rest as deleted', async () => {
    const full = fakeScan({
      'D:\\Videos': [
        scanFile('D:\\Videos\\one.mp4', 'D:\\Videos'),
        scanFile('D:\\Videos\\two.mp4', 'D:\\Videos')
      ]
    })
    const { service, db } = setup({ scan: full })
    service.addRoot('D:\\Videos')
    await service.scanAll()
    expect(db.fileCount()).toBe(2)

    // A cancelled pass sees only part of the folder.
    const partial = fakeScan(
      { 'D:\\Videos': [scanFile('D:\\Videos\\one.mp4', 'D:\\Videos')] },
      {
        cancelled: true
      }
    )
    const again = new IndexerService({ db, scan: partial })
    await again.scanAll()

    expect(db.fileCount()).toBe(2)
    expect(again.getView().lastScan).toMatchObject({ cancelled: true, removed: 0 })
  })

  it('reports folders it could not read instead of failing the scan', async () => {
    const scan = fakeScan(
      { 'D:\\Videos': [scanFile('D:\\Videos\\a.mp4', 'D:\\Videos')] },
      {
        errors: [{ folder: 'D:\\Videos\\locked', message: 'EPERM' }]
      }
    )
    const { service } = setup({ scan })
    service.addRoot('D:\\Videos')

    await service.scanAll()
    expect(service.getView()).toMatchObject({
      files: 1,
      lastError: '1 folder could not be read and were skipped.'
    })
  })

  it('survives a scan that throws, and says which folder failed', async () => {
    const scan = vi.fn(async () => {
      throw new Error('drive disconnected')
    })
    const { service } = setup({ scan })
    service.addRoot('D:\\Videos')

    await service.scanAll()
    expect(service.getView()).toMatchObject({
      status: 'idle',
      lastError: 'Could not index D:\\Videos: drive disconnected'
    })
  })

  it('runs one scan at a time', async () => {
    let started = 0
    const scan = vi.fn(async (options: ScanOptions): Promise<ScanSummary> => {
      started += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { folders: 1, files: 0, bytes: 0, errors: [], cancelled: false, ...options }
    })
    const { service } = setup({ scan: scan as unknown as IndexerServiceDeps['scan'] })
    service.addRoot('D:\\Videos')

    await Promise.all([service.scanAll(), service.scanAll(), service.scanAll()])
    expect(started).toBe(1)
  })

  it('removes a root and everything indexed under it', async () => {
    const scan = fakeScan({ 'D:\\Videos': [scanFile('D:\\Videos\\a.mp4', 'D:\\Videos')] })
    const { service } = setup({ scan })
    service.addRoot('D:\\Videos')
    await service.scanAll()

    service.removeRoot('D:\\Videos')
    expect(service.getView()).toMatchObject({ roots: [], files: 0 })
  })

  it('tells the window about changes', async () => {
    const scan = fakeScan({ 'D:\\Videos': [scanFile('D:\\Videos\\a.mp4', 'D:\\Videos')] })
    const { service, views } = setup({ scan })
    service.addRoot('D:\\Videos')
    await service.scanAll()

    expect(views.length).toBeGreaterThan(1)
    expect(views.at(-1)).toMatchObject({ status: 'idle', files: 1 })
  })
})
