import { describe, expect, it, vi } from 'vitest'
import { STATS_CHANNELS } from '../shared/stats'
import { registerStatsIpc, type StatsBackend } from './statsIpc'
import { FakeIpc } from './testing/fakeIpc'

function setup(trusted = true): { ipc: FakeIpc; backend: StatsBackend; unregister: () => void } {
  const ipc = new FakeIpc()
  const backend = {
    getView: vi.fn(),
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
    neverPlayed: vi.fn()
  } as unknown as StatsBackend
  const unregister = registerStatsIpc(ipc, backend, () => trusted)
  return { ipc, backend, unregister }
}

describe('registerStatsIpc', () => {
  it('forwards each command', () => {
    const { ipc, backend } = setup()
    ipc.invoke(STATS_CHANNELS.getView)
    ipc.invoke(STATS_CHANNELS.addFavorite, 'D:\\Media\\a.mp4')
    ipc.invoke(STATS_CHANNELS.removeFavorite, 'D:\\Media\\a.mp4')

    expect(backend.getView).toHaveBeenCalledTimes(1)
    expect(backend.addFavorite).toHaveBeenCalledWith('D:\\Media\\a.mp4')
    expect(backend.removeFavorite).toHaveBeenCalledWith('D:\\Media\\a.mp4')
  })

  it('rejects a favorite that is not a path', () => {
    const { ipc, backend } = setup()
    for (const bad of [undefined, 42, '', 'x'.repeat(4097), { path: 'D:\\a.mp4' }]) {
      expect(() => ipc.invoke(STATS_CHANNELS.addFavorite, bad)).toThrow('Expected a file path')
      expect(() => ipc.invoke(STATS_CHANNELS.removeFavorite, bad)).toThrow('Expected a file path')
    }
    expect(backend.addFavorite).not.toHaveBeenCalled()
    expect(backend.removeFavorite).not.toHaveBeenCalled()
  })

  it('forwards a never-played request, capping the limit and checking the sort', () => {
    const { ipc, backend } = setup()
    ipc.invoke(STATS_CHANNELS.neverPlayed, 40, 'size')
    ipc.invoke(STATS_CHANNELS.neverPlayed, 99_999, 'name')

    expect(backend.neverPlayed).toHaveBeenCalledWith(40, 'size')
    expect(backend.neverPlayed).toHaveBeenCalledWith(500, 'name')
    for (const [limit, sort] of [
      [0, 'size'],
      [10, 'plays'],
      [10, undefined]
    ]) {
      expect(() => ipc.invoke(STATS_CHANNELS.neverPlayed, limit, sort)).toThrow()
    }
    expect(backend.neverPlayed).toHaveBeenCalledTimes(2)
  })

  it('rejects every request from an untrusted sender', () => {
    const { ipc, backend } = setup(false)
    expect(() => ipc.invoke(STATS_CHANNELS.getView)).toThrow('untrusted sender')
    expect(backend.getView).not.toHaveBeenCalled()
  })

  it('removes all of its handlers', () => {
    const { ipc, unregister } = setup()
    const commands = Object.values(STATS_CHANNELS).filter(
      (channel) => channel !== STATS_CHANNELS.view
    )
    expect(ipc.handlers.size).toBe(commands.length)
    unregister()
    expect(ipc.handlers.size).toBe(0)
  })
})
