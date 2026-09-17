import { describe, expect, it, vi, type Mock } from 'vitest'
import type { LibraryView } from '../../shared/library'
import type { ScanFile, ScanOptions, ScanSummary } from '../files/scanner'
import { IndexDb } from '../library/indexDb'
import { localIndexStore } from '../library/indexStore'
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
  const service = new IndexerService({ db: localIndexStore(db), scan: fakeScan({}), ...deps })
  const views: LibraryView[] = []
  service.onView((view) => views.push(view))
  return { service, db, views }
}

describe('IndexerService cleanup lists', () => {
  async function withFiles(
    files: ScanFile[],
    deps: Partial<IndexerServiceDeps> = {}
  ): Promise<IndexerService> {
    const { service } = setup({ scan: fakeScan({ 'D:\\Media': files }), ...deps })
    await service.addRoot('D:\\Media')
    await service.scanAll()
    return service
  }

  it('lists the folders holding the most, and possible duplicates', async () => {
    const service = await withFiles([
      scanFile('D:\\Media\\a\\clip.mp4', 'D:\\Media', { folder: 'D:\\Media\\a', size: 100 }),
      scanFile('D:\\Media\\b\\clip.mp4', 'D:\\Media', { folder: 'D:\\Media\\b', size: 100 }),
      scanFile('D:\\Media\\a\\other.mp4', 'D:\\Media', { folder: 'D:\\Media\\a', size: 5 })
    ])

    expect(await service.biggestFolders(5)).toEqual([
      { folder: 'D:\\Media\\a', drive: 'D:', files: 2, bytes: 105 },
      { folder: 'D:\\Media\\b', drive: 'D:', files: 1, bytes: 100 }
    ])
    const groups = await service.duplicates(5)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ name: 'clip.mp4', size: 100, wastedBytes: 100 })
  })

  it('lists files nothing has changed in a long time', async () => {
    const now = 400 * 24 * 60 * 60 * 1000
    const service = await withFiles(
      [
        scanFile('D:\\Media\\old.mp4', 'D:\\Media', { size: 900, modifiedMs: 1 }),
        scanFile('D:\\Media\\new.mp4', 'D:\\Media', { size: 900, modifiedMs: now - 1000 })
      ],
      { now: () => now }
    )

    expect((await service.notTouched(180, 10)).map((row) => row.name)).toEqual(['old.mp4'])
    expect(await service.notTouched(3650, 10)).toEqual([])
  })

  it('fingerprints a group so real copies can be told from lookalikes', async () => {
    const digest = vi.fn(async (path: string) => (path.includes('\\b\\') ? 'other' : 'same'))
    const service = await withFiles(
      [
        scanFile('D:\\Media\\a\\clip.mp4', 'D:\\Media', { folder: 'D:\\Media\\a', size: 100 }),
        scanFile('D:\\Media\\b\\clip.mp4', 'D:\\Media', { folder: 'D:\\Media\\b', size: 100 }),
        scanFile('D:\\Media\\c\\clip.mp4', 'D:\\Media', { folder: 'D:\\Media\\c', size: 100 })
      ],
      { digest }
    )

    expect(await service.checkDuplicate('clip.mp4', 100)).toEqual([
      { path: 'D:\\Media\\a\\clip.mp4', digest: 'same' },
      { path: 'D:\\Media\\b\\clip.mp4', digest: 'other' },
      { path: 'D:\\Media\\c\\clip.mp4', digest: 'same' }
    ])
    expect(digest).toHaveBeenCalledTimes(3)
  })

  it('reports a null fingerprint for a file it cannot read', async () => {
    const digest = vi.fn(async () => null)
    const service = await withFiles(
      [
        scanFile('D:\\Media\\a\\clip.mp4', 'D:\\Media', { folder: 'D:\\Media\\a', size: 100 }),
        scanFile('D:\\Media\\b\\clip.mp4', 'D:\\Media', { folder: 'D:\\Media\\b', size: 100 })
      ],
      { digest }
    )

    expect(await service.checkDuplicate('clip.mp4', 100)).toEqual([
      { path: 'D:\\Media\\a\\clip.mp4', digest: null },
      { path: 'D:\\Media\\b\\clip.mp4', digest: null }
    ])
  })
})

describe('IndexerService opening files', () => {
  async function withIndexedFile(deps: Partial<IndexerServiceDeps> = {}): Promise<IndexerService> {
    const scan = fakeScan({ 'D:\\Videos': [scanFile('D:\\Videos\\a.mp4', 'D:\\Videos')] })
    const { service } = setup({ scan, ...deps })
    await service.addRoot('D:\\Videos')
    await service.scanAll()
    return service
  }

  it('opens a file that is in the index', async () => {
    const openPath = vi.fn(async () => '')
    const service = await withIndexedFile({ openPath })

    await service.openFile('D:\\Videos\\a.mp4')
    expect(openPath).toHaveBeenCalledWith('D:\\Videos\\a.mp4')
    expect((await service.getView()).lastError).toBeNull()
  })

  it('also opens a file known only from play history', async () => {
    const openPath = vi.fn(async () => '')
    const { service, db } = setup({ openPath })
    db.recordOpened('E:\\Shows\\ep1.mkv', 'ep1.mkv', 'E:\\Shows', 1)

    await service.openFile('E:\\Shows\\ep1.mkv')
    expect(openPath).toHaveBeenCalledWith('E:\\Shows\\ep1.mkv')
  })

  it('refuses a path that is not in the index', async () => {
    const openPath = vi.fn(async () => '')
    const service = await withIndexedFile({ openPath })

    await service.openFile('C:\\Windows\\System32\\cmd.exe')
    expect(openPath).not.toHaveBeenCalled()
    expect((await service.getView()).lastError).toContain('is not in the index')
  })

  it('explains when the system cannot open the file', async () => {
    const openPath = vi.fn(async () => 'no application is registered for .mp4')
    const service = await withIndexedFile({ openPath })

    await service.openFile('D:\\Videos\\a.mp4')
    expect((await service.getView()).lastError).toBe(
      'Could not open D:\\Videos\\a.mp4: no application is registered for .mp4'
    )
  })

  it('shows an indexed file in the file manager, and refuses anything else', async () => {
    const revealPath = vi.fn(async () => {})
    const service = await withIndexedFile({ revealPath })

    await service.showInFolder('D:\\Videos\\a.mp4')
    expect(revealPath).toHaveBeenCalledWith('D:\\Videos\\a.mp4')

    await service.showInFolder('D:\\Videos\\gone.mp4')
    expect(revealPath).toHaveBeenCalledTimes(1)
    expect((await service.getView()).lastError).toContain('is not in the index')
  })
})

describe('IndexerService excluded folders', () => {
  const windowsRules = { prefixes: [], caseInsensitive: true }

  async function indexed(
    pickFolder: IndexerServiceDeps['pickFolder'],
    scan = fakeScan({
      'D:\\Media': [
        scanFile('D:\\Media\\Games\\intro.mp4', 'D:\\Media', { folder: 'D:\\Media\\Games' }),
        scanFile('D:\\Media\\Home\\beach.mp4', 'D:\\Media', { folder: 'D:\\Media\\Home' })
      ]
    })
  ): Promise<{ service: IndexerService; scan: typeof scan }> {
    const { service } = setup({ scan, pickFolder, rules: windowsRules })
    await service.addRoot('D:\\Media')
    await service.scanAll()
    return { service, scan }
  }

  it('drops what is indexed inside an excluded folder straight away, and skips it in scans', async () => {
    const pickFolder = vi.fn(async () => 'D:\\Media\\Games')
    const { service, scan } = await indexed(pickFolder)
    expect((await service.getView()).files).toBe(2)

    const view = await service.chooseExcluded()
    expect(pickFolder).toHaveBeenCalledWith('exclude')
    expect(view.excluded).toEqual(['D:\\Media\\Games'])
    expect(view.files).toBe(1)
    expect(view.roots[0]).toMatchObject({ path: 'D:\\Media', files: 1 })
    expect(view.lastError).toBeNull()

    await service.scanAll()
    expect(scan.mock.lastCall?.[0].rules).toEqual({
      ...windowsRules,
      excluded: ['D:\\Media\\Games']
    })
  })

  it('forgets an exclusion when asked, leaving the next scan to bring the files back', async () => {
    const { service } = await indexed(vi.fn(async () => 'D:\\Media\\Games'))
    await service.chooseExcluded()

    expect((await service.removeExcluded('D:\\Media\\Games')).excluded).toEqual([])
  })

  it('refuses to exclude an indexed folder or one that holds it', async () => {
    const pickFolder = vi.fn<(purpose: 'index' | 'exclude') => Promise<string | null>>()
    const { service } = await indexed(pickFolder)

    pickFolder.mockResolvedValueOnce('D:\\Media')
    let view = await service.chooseExcluded()
    expect(view.lastError).toBe(
      'D:\\Media is an indexed folder. Remove it from Indexed folders instead.'
    )

    pickFolder.mockResolvedValueOnce('D:\\')
    view = await service.chooseExcluded()
    expect(view.lastError).toContain('holds the indexed folder D:\\Media')
    expect(view.excluded).toEqual([])
    expect(view.files).toBe(2)
  })

  it('refuses to index a folder inside an excluded one', async () => {
    const pickFolder = vi.fn<(purpose: 'index' | 'exclude') => Promise<string | null>>()
    const { service } = await indexed(pickFolder)
    pickFolder.mockResolvedValueOnce('D:\\Media\\Games')
    await service.chooseExcluded()

    pickFolder.mockResolvedValueOnce('d:\\media\\games\\Saves')
    const view = await service.chooseRoot()
    expect(view.roots.map((root) => root.path)).toEqual(['D:\\Media'])
    expect(view.lastError).toContain('is inside the excluded folder D:\\Media\\Games')
  })

  it('leaves exclusions alone while a scan is running', async () => {
    let finish = (): void => {}
    const scan = vi.fn(
      () =>
        new Promise<ScanSummary>((resolve) => {
          finish = () => resolve({ folders: 0, files: 0, bytes: 0, errors: [], cancelled: false })
        })
    )
    const pickFolder = vi.fn(async () => 'D:\\Media\\Games')
    const { service } = setup({ scan, pickFolder, rules: windowsRules })
    await service.addRoot('D:\\Media')
    const scanning = service.scanAll()

    const view = await service.chooseExcluded()
    expect(pickFolder).not.toHaveBeenCalled()
    expect(view.lastError).toBe('Stop the scan before changing excluded folders.')
    finish()
    await scanning
  })
})

describe('IndexerService drives and folder picking', () => {
  it('indexes the folder the picker returns', async () => {
    const pickFolder = vi.fn(async () => 'D:\\Videos')
    const { service } = setup({ pickFolder })

    await service.chooseRoot()
    expect((await service.getView()).roots.map((root) => root.path)).toEqual(['D:\\Videos'])
  })

  it('changes nothing when the picker is cancelled', async () => {
    const pickFolder = vi.fn(async () => null)
    const { service } = setup({ pickFolder })

    await service.chooseRoot()
    expect(pickFolder).toHaveBeenCalledTimes(1)
    expect((await service.getView()).roots).toEqual([])
  })

  it('shows each drive’s size and free space alongside what was indexed', async () => {
    const scan = fakeScan({
      'D:\\Videos': [scanFile('D:\\Videos\\a.mp4', 'D:\\Videos', { size: 8 })]
    })
    const { service } = setup({
      scan,
      driveSpace: async () => ({ total: 1000, free: 400 })
    })
    await service.addRoot('D:\\Videos')
    await service.scanAll()

    expect((await service.getView()).drives).toEqual([
      { drive: 'D:', files: 1, bytes: 8, total: 1000, free: 400 }
    ])
  })

  it('lists a drive that has a root but nothing indexed yet', async () => {
    const { service } = setup({ driveSpace: async () => ({ total: 500, free: 100 }) })
    await service.addRoot('E:\\Photos')
    await service.refreshDriveSpace()

    expect((await service.getView()).drives).toEqual([
      { drive: 'E:', files: 0, bytes: 0, total: 500, free: 100 }
    ])
  })

  it('leaves capacity empty when a drive cannot be read, rather than failing', async () => {
    const { service } = setup({ driveSpace: async () => null })
    await service.addRoot('Z:\\Unplugged')
    await service.refreshDriveSpace()

    expect((await service.getView()).drives).toEqual([
      { drive: 'Z:', files: 0, bytes: 0, total: null, free: null }
    ])
  })
})

describe('IndexerService', () => {
  it('starts empty and offers the default folders only when nothing is indexed', async () => {
    const { service, db } = setup({ defaultRoots: () => ['D:\\Videos', 'D:\\Pictures'] })
    expect(await service.getView()).toMatchObject({ status: 'idle', roots: [], files: 0, bytes: 0 })

    await service.addDefaultRoots()
    expect((await service.getView()).roots.map((root) => root.path)).toEqual([
      'D:\\Pictures',
      'D:\\Videos'
    ])

    db.addRoot('E:\\More')
    await service.addDefaultRoots()
    expect((await service.getView()).roots).toHaveLength(3)
  })

  it('indexes each root and totals what it found', async () => {
    const scan = fakeScan({
      'D:\\Videos': [scanFile('D:\\Videos\\a.mp4', 'D:\\Videos', { size: 100 })],
      'D:\\Pictures': [
        scanFile('D:\\Pictures\\b.jpg', 'D:\\Pictures', { category: 'photo', size: 20 })
      ]
    })
    const { service } = setup({ scan })
    await service.addRoot('D:\\Videos')
    await service.addRoot('D:\\Pictures')

    await service.scanAll()

    const view = await service.getView()
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
    await service.addRoot('D:\\Videos')
    await service.scanAll()
    expect(db.fileCount()).toBe(2)

    const second = fakeScan({ 'D:\\Videos': [scanFile('D:\\Videos\\stays.mp4', 'D:\\Videos')] })
    const resumed = new IndexerService({ db: localIndexStore(db), scan: second })
    await resumed.scanAll()

    expect(db.fileCount()).toBe(1)
    expect((await resumed.getView()).lastScan).toMatchObject({ removed: 1 })
  })

  it('keeps what a cancelled scan found without treating the rest as deleted', async () => {
    const full = fakeScan({
      'D:\\Videos': [
        scanFile('D:\\Videos\\one.mp4', 'D:\\Videos'),
        scanFile('D:\\Videos\\two.mp4', 'D:\\Videos')
      ]
    })
    const { service, db } = setup({ scan: full })
    await service.addRoot('D:\\Videos')
    await service.scanAll()
    expect(db.fileCount()).toBe(2)

    // A cancelled pass sees only part of the folder.
    const partial = fakeScan(
      { 'D:\\Videos': [scanFile('D:\\Videos\\one.mp4', 'D:\\Videos')] },
      {
        cancelled: true
      }
    )
    const again = new IndexerService({ db: localIndexStore(db), scan: partial })
    await again.scanAll()

    expect(db.fileCount()).toBe(2)
    expect((await again.getView()).lastScan).toMatchObject({ cancelled: true, removed: 0 })
  })

  it('reports folders it could not read instead of failing the scan', async () => {
    const scan = fakeScan(
      { 'D:\\Videos': [scanFile('D:\\Videos\\a.mp4', 'D:\\Videos')] },
      {
        errors: [{ folder: 'D:\\Videos\\locked', message: 'EPERM' }]
      }
    )
    const { service } = setup({ scan })
    await service.addRoot('D:\\Videos')

    await service.scanAll()
    expect(await service.getView()).toMatchObject({
      files: 1,
      lastError: '1 folder could not be read and were skipped.'
    })
  })

  it('survives a scan that throws, and says which folder failed', async () => {
    const scan = vi.fn(async () => {
      throw new Error('drive disconnected')
    })
    const { service } = setup({ scan })
    await service.addRoot('D:\\Videos')

    await service.scanAll()
    expect(await service.getView()).toMatchObject({
      status: 'idle',
      lastError: 'Could not index D:\\Videos: drive disconnected'
    })
  })

  it('rescans a single folder, leaving the others alone', async () => {
    const scan = fakeScan({
      'D:\\Videos': [scanFile('D:\\Videos\\a.mp4', 'D:\\Videos')],
      'D:\\Pictures': [scanFile('D:\\Pictures\\b.jpg', 'D:\\Pictures', { category: 'photo' })]
    })
    const { service } = setup({ scan })
    await service.addRoot('D:\\Videos')
    await service.addRoot('D:\\Pictures')

    await service.scanRoot('D:\\Pictures')
    expect(scan).toHaveBeenCalledTimes(1)
    expect(scan.mock.calls[0]?.[0].roots).toEqual(['D:\\Pictures'])
    expect(service.isScanning()).toBe(false)
  })

  it('reuses totals between views, recomputing them only when the index changes', async () => {
    const scan = fakeScan({
      'D:\\Videos': [scanFile('D:\\Videos\\a.mp4', 'D:\\Videos', { size: 10 })]
    })
    const { service, db } = setup({ scan })
    const byCategory = vi.spyOn(db, 'totalsByCategory')
    await service.addRoot('D:\\Videos')

    for (let i = 0; i < 5; i++) await service.getView()
    expect(byCategory).toHaveBeenCalledTimes(1)

    await service.scanAll()
    expect(await service.getView()).toMatchObject({ files: 1, bytes: 10 })
    const afterScan = byCategory.mock.calls.length
    for (let i = 0; i < 5; i++) await service.getView()
    expect(byCategory).toHaveBeenCalledTimes(afterScan)

    await service.removeRoot('D:\\Videos')
    expect(await service.getView()).toMatchObject({ files: 0, bytes: 0 })
  })

  it('runs one scan at a time', async () => {
    let started = 0
    const scan = vi.fn(async (options: ScanOptions): Promise<ScanSummary> => {
      started += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { folders: 1, files: 0, bytes: 0, errors: [], cancelled: false, ...options }
    })
    const { service } = setup({ scan: scan as unknown as IndexerServiceDeps['scan'] })
    await service.addRoot('D:\\Videos')

    await Promise.all([service.scanAll(), service.scanAll(), service.scanAll()])
    expect(started).toBe(1)
  })

  it('removes a root and everything indexed under it', async () => {
    const scan = fakeScan({ 'D:\\Videos': [scanFile('D:\\Videos\\a.mp4', 'D:\\Videos')] })
    const { service } = setup({ scan })
    await service.addRoot('D:\\Videos')
    await service.scanAll()

    await service.removeRoot('D:\\Videos')
    expect(await service.getView()).toMatchObject({ roots: [], files: 0 })
  })

  it('tells the window about changes', async () => {
    const scan = fakeScan({ 'D:\\Videos': [scanFile('D:\\Videos\\a.mp4', 'D:\\Videos')] })
    const { service, views } = setup({ scan })
    await service.addRoot('D:\\Videos')
    await service.scanAll()

    expect(views.length).toBeGreaterThan(1)
    expect(views.at(-1)).toMatchObject({ status: 'idle', files: 1 })
  })
})
