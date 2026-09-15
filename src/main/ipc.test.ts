import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { CHANNELS } from '../shared/shuffler'
import { registerShufflerIpc, type IpcRegistry, type ShufflerBackend } from './ipc'

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
    if (handler === undefined) throw new Error(`No handler for ${channel}`)
    return handler({} as IpcMainInvokeEvent, ...args)
  }
}

function setup(trusted = true): { ipc: FakeIpc; backend: ShufflerBackend; unregister: () => void } {
  const ipc = new FakeIpc()
  const backend = {
    getView: vi.fn(),
    chooseFolder: vi.fn(),
    play: vi.fn(),
    next: vi.fn(),
    back: vi.fn(),
    deleteCurrent: vi.fn(),
    undoDelete: vi.fn()
  } as unknown as ShufflerBackend
  const unregister = registerShufflerIpc(ipc, backend, () => trusted)
  return { ipc, backend, unregister }
}

describe('registerShufflerIpc', () => {
  it('forwards each command to the shuffler', () => {
    const { ipc, backend } = setup()
    ipc.invoke(CHANNELS.getView)
    ipc.invoke(CHANNELS.chooseFolder)
    ipc.invoke(CHANNELS.play)
    ipc.invoke(CHANNELS.next)
    ipc.invoke(CHANNELS.back)
    ipc.invoke(CHANNELS.deleteCurrent)
    ipc.invoke(CHANNELS.undoDelete, 'clip.mkv')

    expect(backend.getView).toHaveBeenCalledTimes(1)
    expect(backend.chooseFolder).toHaveBeenCalledTimes(1)
    expect(backend.play).toHaveBeenCalledTimes(1)
    expect(backend.next).toHaveBeenCalledTimes(1)
    expect(backend.back).toHaveBeenCalledTimes(1)
    expect(backend.deleteCurrent).toHaveBeenCalledTimes(1)
    expect(backend.undoDelete).toHaveBeenCalledWith('clip.mkv')
  })

  it('ignores extra arguments instead of passing them on', () => {
    const { ipc, backend } = setup()
    ipc.invoke(CHANNELS.next, '/etc/passwd')
    expect(backend.next).toHaveBeenCalledWith()
  })

  it('rejects undo requests that are not a file name', () => {
    const { ipc, backend } = setup()
    for (const bad of [undefined, 42, '', 'x'.repeat(1025), { id: 'clip.mkv' }]) {
      expect(() => ipc.invoke(CHANNELS.undoDelete, bad)).toThrow(
        'undoDelete expects the name of a pending delete'
      )
    }
    expect(backend.undoDelete).not.toHaveBeenCalled()
  })

  it('rejects every request from an untrusted sender', () => {
    const { ipc, backend } = setup(false)
    expect(() => ipc.invoke(CHANNELS.deleteCurrent)).toThrow(
      'Rejected a request from an untrusted sender'
    )
    expect(backend.deleteCurrent).not.toHaveBeenCalled()
  })

  it('removes all of its handlers', () => {
    const { ipc, unregister } = setup()
    expect(ipc.handlers.size).toBe(7)
    unregister()
    expect(ipc.handlers.size).toBe(0)
  })
})
