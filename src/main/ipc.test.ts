import { describe, expect, it, vi } from 'vitest'
import { CHANNELS } from '../shared/shuffler'
import { registerShufflerIpc, type ShufflerBackend } from './ipc'
import { FakeIpc } from './testing/fakeIpc'

function setup(trusted = true): { ipc: FakeIpc; backend: ShufflerBackend; unregister: () => void } {
  const ipc = new FakeIpc()
  const backend = {
    getView: vi.fn(),
    chooseFolder: vi.fn(),
    play: vi.fn(),
    next: vi.fn(),
    back: vi.fn(),
    deleteCurrent: vi.fn(),
    undoDelete: vi.fn(),
    restartCycle: vi.fn()
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
    ipc.invoke(CHANNELS.restartCycle)

    expect(backend.getView).toHaveBeenCalledTimes(1)
    expect(backend.chooseFolder).toHaveBeenCalledTimes(1)
    expect(backend.play).toHaveBeenCalledTimes(1)
    expect(backend.next).toHaveBeenCalledTimes(1)
    expect(backend.back).toHaveBeenCalledTimes(1)
    expect(backend.deleteCurrent).toHaveBeenCalledTimes(1)
    expect(backend.undoDelete).toHaveBeenCalledWith('clip.mkv')
    expect(backend.restartCycle).toHaveBeenCalledTimes(1)
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
    // One handler per channel, except `view`, which goes main → renderer.
    const commands = Object.values(CHANNELS).filter((channel) => channel !== CHANNELS.view)
    expect(ipc.handlers.size).toBe(commands.length)
    unregister()
    expect(ipc.handlers.size).toBe(0)
  })
})
