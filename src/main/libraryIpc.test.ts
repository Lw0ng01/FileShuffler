import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { LIBRARY_CHANNELS } from '../shared/library'
import type { IpcRegistry } from './ipc'
import { registerLibraryIpc, type LibraryBackend } from './libraryIpc'

/** Stands in for Electron's ipcMain, keeping the handlers so a test can call them. */
class FakeIpc implements IpcRegistry {
  readonly handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()

  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void {
    this.handlers.set(channel, listener)
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel)
  }

  invoke(channel: string, ...args: unknown[]): unknown {
    const handler = this.handlers.get(channel)
    if (handler === undefined) throw new Error(`no handler for ${channel}`)
    return handler({} as IpcMainInvokeEvent, ...args)
  }
}

function setup(trusted = true): { ipc: FakeIpc; backend: LibraryBackend; unregister: () => void } {
  const ipc = new FakeIpc()
  const backend = {
    getView: vi.fn(),
    refreshDriveSpace: vi.fn(async () => {}),
    addRoot: vi.fn(),
    chooseRoot: vi.fn(),
    removeRoot: vi.fn(),
    scanAll: vi.fn(),
    cancelScan: vi.fn(),
    largest: vi.fn(),
    recent: vi.fn(),
    search: vi.fn(),
    openFile: vi.fn(),
    showInFolder: vi.fn(),
    biggestFolders: vi.fn(),
    duplicates: vi.fn(),
    notTouched: vi.fn(),
    checkDuplicate: vi.fn(),
    query: vi.fn()
  } as unknown as LibraryBackend
  const unregister = registerLibraryIpc(ipc, backend, () => trusted)
  return { ipc, backend, unregister }
}

describe('registerLibraryIpc', () => {
  it('forwards each command to the indexer', async () => {
    const { ipc, backend } = setup()
    // getView refreshes drive capacity first, so its handler is async and has to be awaited.
    await ipc.invoke(LIBRARY_CHANNELS.getView)
    ipc.invoke(LIBRARY_CHANNELS.addRoot, 'D:\\Videos')
    ipc.invoke(LIBRARY_CHANNELS.chooseRoot)
    ipc.invoke(LIBRARY_CHANNELS.removeRoot, 'D:\\Videos')
    ipc.invoke(LIBRARY_CHANNELS.scan)
    ipc.invoke(LIBRARY_CHANNELS.cancelScan)
    ipc.invoke(LIBRARY_CHANNELS.largest, 10)
    ipc.invoke(LIBRARY_CHANNELS.recent)
    ipc.invoke(LIBRARY_CHANNELS.search, 'beach', 5)
    ipc.invoke(LIBRARY_CHANNELS.openFile, 'D:\\Videos\\a.mp4')
    ipc.invoke(LIBRARY_CHANNELS.showInFolder, 'D:\\Videos\\a.mp4')

    expect(backend.refreshDriveSpace).toHaveBeenCalledTimes(1)
    expect(backend.getView).toHaveBeenCalledTimes(1)
    expect(backend.addRoot).toHaveBeenCalledWith('D:\\Videos')
    expect(backend.chooseRoot).toHaveBeenCalledTimes(1)
    expect(backend.removeRoot).toHaveBeenCalledWith('D:\\Videos')
    expect(backend.scanAll).toHaveBeenCalledTimes(1)
    expect(backend.cancelScan).toHaveBeenCalledTimes(1)
    expect(backend.largest).toHaveBeenCalledWith(10)
    expect(backend.recent).toHaveBeenCalledWith(undefined)
    expect(backend.search).toHaveBeenCalledWith('beach', 5)
    expect(backend.openFile).toHaveBeenCalledWith('D:\\Videos\\a.mp4')
    expect(backend.showInFolder).toHaveBeenCalledWith('D:\\Videos\\a.mp4')
  })

  it('forwards the cleanup queries', () => {
    const { ipc, backend } = setup()
    ipc.invoke(LIBRARY_CHANNELS.biggestFolders, 5)
    ipc.invoke(LIBRARY_CHANNELS.duplicates)
    ipc.invoke(LIBRARY_CHANNELS.notTouched, 90, 10)
    ipc.invoke(LIBRARY_CHANNELS.checkDuplicate, 'clip.mp4', 100)

    expect(backend.biggestFolders).toHaveBeenCalledWith(5)
    expect(backend.duplicates).toHaveBeenCalledWith(undefined)
    expect(backend.notTouched).toHaveBeenCalledWith(90, 10)
    expect(backend.checkDuplicate).toHaveBeenCalledWith('clip.mp4', 100)
  })

  it('rejects cleanup arguments that are not numbers', () => {
    const { ipc, backend } = setup()
    for (const bad of [0, -1, 'ninety']) {
      expect(() => ipc.invoke(LIBRARY_CHANNELS.notTouched, bad)).toThrow('number of days')
    }
    for (const bad of [-1, 'big', undefined]) {
      expect(() => ipc.invoke(LIBRARY_CHANNELS.checkDuplicate, 'clip.mp4', bad)).toThrow(
        'file size'
      )
    }
    expect(backend.notTouched).not.toHaveBeenCalled()
    expect(backend.checkDuplicate).not.toHaveBeenCalled()
  })

  it('forwards a browsing query, keeping only the fields it knows', () => {
    const { ipc, backend } = setup()
    ipc.invoke(LIBRARY_CHANNELS.query, {
      term: 'beach',
      categories: ['video', 'photo'],
      drives: ['D:'],
      minSize: 1_000,
      maxSize: 5_000,
      sort: 'size',
      direction: 'asc',
      offset: 50,
      limit: 50,
      sql: 'drop table files'
    })

    expect(backend.query).toHaveBeenCalledWith({
      term: 'beach',
      categories: ['video', 'photo'],
      drives: ['D:'],
      minSize: 1_000,
      maxSize: 5_000,
      sort: 'size',
      direction: 'asc',
      offset: 50,
      limit: 50
    })
  })

  it('rejects a browsing query with anything out of range or off the known lists', () => {
    const { ipc, backend } = setup()
    const bad = [
      undefined,
      'files',
      [],
      { categories: ['executable'] },
      { categories: 'video' },
      { drives: ['x'.repeat(17)] },
      { minSize: -1 },
      { maxSize: Number.POSITIVE_INFINITY },
      { sort: 'path; drop table files' },
      { direction: 'sideways' },
      { offset: -5 },
      { limit: 0 },
      { term: 42 }
    ]
    for (const query of bad) {
      expect(() => ipc.invoke(LIBRARY_CHANNELS.query, query)).toThrow()
    }
    expect(backend.query).not.toHaveBeenCalled()
  })

  it('rejects an open request that is not a path', () => {
    const { ipc, backend } = setup()
    for (const bad of [undefined, 42, '', { path: 'D:\\a.mp4' }]) {
      expect(() => ipc.invoke(LIBRARY_CHANNELS.openFile, bad)).toThrow('Expected a folder path')
      expect(() => ipc.invoke(LIBRARY_CHANNELS.showInFolder, bad)).toThrow('Expected a folder path')
    }
    expect(backend.openFile).not.toHaveBeenCalled()
    expect(backend.showInFolder).not.toHaveBeenCalled()
  })

  it('rejects a root that is not a path', () => {
    const { ipc, backend } = setup()
    for (const bad of [undefined, 42, '', 'x'.repeat(4097), { path: 'D:\\' }]) {
      expect(() => ipc.invoke(LIBRARY_CHANNELS.addRoot, bad)).toThrow('Expected a folder path')
    }
    expect(backend.addRoot).not.toHaveBeenCalled()
  })

  it('rejects a limit that is not a positive number, and caps a huge one', () => {
    const { ipc, backend } = setup()
    for (const bad of [0, -5, 'ten', Number.NaN]) {
      expect(() => ipc.invoke(LIBRARY_CHANNELS.largest, bad)).toThrow('positive row limit')
    }
    ipc.invoke(LIBRARY_CHANNELS.largest, 10_000)
    expect(backend.largest).toHaveBeenCalledWith(500)
  })

  it('rejects a search term that is not a string, or too long', () => {
    const { ipc, backend } = setup()
    expect(() => ipc.invoke(LIBRARY_CHANNELS.search, 42)).toThrow('Expected a search term')
    expect(() => ipc.invoke(LIBRARY_CHANNELS.search, 'x'.repeat(257))).toThrow(
      'Expected a search term'
    )
    expect(backend.search).not.toHaveBeenCalled()
  })

  it('rejects every request from an untrusted sender', () => {
    const { ipc, backend } = setup(false)
    expect(() => ipc.invoke(LIBRARY_CHANNELS.scan)).toThrow('untrusted sender')
    expect(backend.scanAll).not.toHaveBeenCalled()
  })

  it('removes all of its handlers', () => {
    const { ipc, unregister } = setup()
    const commands = Object.values(LIBRARY_CHANNELS).filter(
      (channel) => channel !== LIBRARY_CHANNELS.view
    )
    expect(ipc.handlers.size).toBe(commands.length)
    unregister()
    expect(ipc.handlers.size).toBe(0)
  })
})
